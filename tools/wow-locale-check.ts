import { tool } from "@opencode-ai/plugin";
import os from "node:os";
import path from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import {
  renderError,
  renderNoMatch,
  renderReport,
  runRg,
  TITLES,
  type MetadataPair,
} from "./_shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Resolution =
  | {
      mode: "addon-root";
      localesDir: string;
      codeRoot: string;
      displayLabel: string;
    }
  | {
      mode: "locales-only";
      localesDir: string;
      codeRoot: string;
      displayLabel: string;
    }
  | { mode: "single-file"; file: string; displayLabel: string }
  | { mode: "error"; reason: string };

type SkipReason =
  | "non-standard-locale-name"
  | "concatenated-key"
  | "dynamic-key"
  | "multiline-string-key"
  | "dynamic-reference";

interface KeyLocation {
  readonly file: string;
  readonly line: number;
}

type LocaleData = Map<string, Map<string, KeyLocation>>;
type RefMap = Map<string, KeyLocation[]>;

interface Findings {
  missing: { locale: string; key: string; baseFile: string; baseLine: number }[];
  unused: { key: string; file: string; line: number }[];
  undefinedRefs: { key: string; file: string; line: number }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCALE_FILENAME_PATTERN = /^([a-z]{2}[A-Z]{2})\.lua$/;
const LOCALE_DIRNAME_PATTERN = /^[a-z]{2}[A-Z]{2}$/;

const CANONICAL_LOCALE_ORDER = [
  "enUS",
  "deDE",
  "esES",
  "esMX",
  "frFR",
  "itIT",
  "koKR",
  "ptBR",
  "ruRU",
  "zhCN",
  "zhTW",
];

const EXCLUDED_DIRS = new Set(["Locales", "locales", "Libs", "libs", ".git", "embeds"]);

// rg's `-g '!Locales/**'` only matches paths relative to its search root.
// When we pass an absolute search root, rg evaluates each candidate using its
// FULL absolute path against the glob, so a leading `**/` is required for the
// exclusion to bite. Without it, files under `<root>/Locales/` (and friends)
// leak into the result and pollute the reference set.
const RG_GLOBS: readonly string[] = [
  "-g",
  "*.lua",
  "-g",
  "!**/Locales/**",
  "-g",
  "!**/Libs/**",
  "-g",
  "!**/libs/**",
  "-g",
  "!**/.git/**",
  "-g",
  "!**/embeds/**",
];

const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  "non-standard-locale-name":
    "Files with non-standard locale names skipped (expected `<lang><region>.lua`).",
  "concatenated-key": "Concatenated keys (`L[\"a\" .. \"b\"]`) skipped.",
  "dynamic-key": "Dynamic keys (`L[variable]`) in locale files skipped.",
  "multiline-string-key": "Multi-line string keys (`L[[[ ... ]]]`) skipped.",
  "dynamic-reference": "Dynamic key references (`L[variable]`) in source skipped.",
};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function expandHome(target: string): string {
  if (target.startsWith("~")) {
    const rest = target.slice(1).replace(/^[/\\]/, "");
    return path.join(os.homedir(), rest);
  }
  return target;
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

export function resolveTarget(target: string): Resolution {
  const trimmed = target.trim();
  if (!trimmed) {
    return { mode: "error", reason: "Empty target." };
  }

  const resolvedPath = expandHome(trimmed);
  if (!existsSync(resolvedPath)) {
    return { mode: "error", reason: `Path does not exist: ${trimmed}` };
  }

  let stat;
  try {
    stat = statSync(resolvedPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { mode: "error", reason: `Cannot stat target: ${message}` };
  }

  if (stat.isFile()) {
    if (!resolvedPath.endsWith(".lua")) {
      return {
        mode: "error",
        reason: "File target must be a `.lua` file.",
      };
    }
    return { mode: "single-file", file: resolvedPath, displayLabel: trimmed };
  }

  if (!stat.isDirectory()) {
    return {
      mode: "error",
      reason: "Target is neither a directory nor a regular file.",
    };
  }

  const entries = readdirSync(resolvedPath, { withFileTypes: true });

  // Rule 1: directory containing a Locales/ subdir → addon-root mode.
  const localesSub = entries.find(
    (e) => e.isDirectory() && e.name.toLowerCase() === "locales",
  );
  if (localesSub) {
    return {
      mode: "addon-root",
      localesDir: path.join(resolvedPath, localesSub.name),
      codeRoot: resolvedPath,
      displayLabel: trimmed,
    };
  }

  // Rule 2: locales-only mode.
  const basenameIsLocales = path.basename(resolvedPath).toLowerCase() === "locales";
  const hasLocaleFiles = entries.some(
    (e) => e.isFile() && LOCALE_FILENAME_PATTERN.test(e.name),
  );
  const hasLocaleSubdirs = entries.some(
    (e) => e.isDirectory() && LOCALE_DIRNAME_PATTERN.test(e.name),
  );
  if (basenameIsLocales || hasLocaleFiles || hasLocaleSubdirs) {
    return {
      mode: "locales-only",
      localesDir: resolvedPath,
      codeRoot: path.dirname(resolvedPath),
      displayLabel: trimmed,
    };
  }

  return {
    mode: "error",
    reason:
      "Directory contains neither a `Locales/` subdir nor `<lang><region>.lua` locale files.",
  };
}

// ---------------------------------------------------------------------------
// Lua line comment stripping
// ---------------------------------------------------------------------------

/**
 * Strip a single-line `--` comment from a Lua source line, respecting string
 * quote state. Block comments (`--[[ ... ]]`) are explicitly out of scope per
 * the tool contract; multi-line strings are not handled.
 */
function stripLineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (!inSingle && !inDouble && c === "-" && line[i + 1] === "-") {
      return line.slice(0, i);
    }
    if (!inDouble && c === "'" && line[i - 1] !== "\\") {
      inSingle = !inSingle;
    } else if (!inSingle && c === '"' && line[i - 1] !== "\\") {
      inDouble = !inDouble;
    }
  }
  return line;
}

// ---------------------------------------------------------------------------
// Locale-file parser
// ---------------------------------------------------------------------------

interface ParsedLocaleFile {
  readonly locale: string;
  readonly keys: Map<string, number>;
  readonly skipped: SkipReason[];
}

const KEY_PATTERNS: readonly RegExp[] = [
  /L\["([^"]+)"\]\s*=/g,
  /L\['([^']+)'\]\s*=/g,
  /\[\s*"([^"]+)"\s*\]\s*=/g,
  /\[\s*'([^']+)'\s*\]\s*=/g,
];

const DYNAMIC_KEY_PATTERN = /L\[\s*[A-Za-z_]\w*\s*\]/;
const CONCAT_KEY_PATTERN =
  /L\[\s*(?:"[^"]*"|'[^']*')\s*\.\.|L\[\s*[A-Za-z_]\w*\s*\.\./;
const MULTILINE_STRING_KEY_PATTERN = /L\[\s*\[\[/;

export function parseLocaleFile(
  content: string,
  filename: string,
): ParsedLocaleFile {
  const baseName = path.basename(filename);
  const localeMatch = LOCALE_FILENAME_PATTERN.exec(baseName);
  if (!localeMatch) {
    return {
      locale: "",
      keys: new Map(),
      skipped: ["non-standard-locale-name"],
    };
  }
  const { keys, skipped } = parseKeyTable(content);
  return { locale: localeMatch[1], keys, skipped };
}

function parseKeyTable(content: string): {
  keys: Map<string, number>;
  skipped: SkipReason[];
} {
  const keys = new Map<string, number>();
  const skipped = new Set<SkipReason>();
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const stripped = stripLineComment(lines[i]);
    if (!stripped.trim()) continue;

    if (CONCAT_KEY_PATTERN.test(stripped)) skipped.add("concatenated-key");
    else if (DYNAMIC_KEY_PATTERN.test(stripped)) skipped.add("dynamic-key");
    if (MULTILINE_STRING_KEY_PATTERN.test(stripped)) {
      skipped.add("multiline-string-key");
    }

    for (const pattern of KEY_PATTERNS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(stripped)) !== null) {
        if (!keys.has(m[1])) keys.set(m[1], i + 1);
      }
    }
  }
  return { keys, skipped: [...skipped] };
}

// ---------------------------------------------------------------------------
// Locale aggregation (filesystem)
// ---------------------------------------------------------------------------

async function gatherLocales(
  localesDir: string,
  codeRoot: string,
): Promise<{ data: LocaleData; skipped: Set<SkipReason> }> {
  const data: LocaleData = new Map();
  const skipped = new Set<SkipReason>();
  const entries = readdirSync(localesDir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(localesDir, entry.name);

    if (entry.isFile()) {
      if (!entry.name.endsWith(".lua")) continue;
      if (!LOCALE_FILENAME_PATTERN.test(entry.name)) {
        // A .lua file in Locales/ that doesn't fit the convention. Surface
        // it via SkipReason so the user knows it was deliberately ignored
        // rather than silently dropped.
        skipped.add("non-standard-locale-name");
        continue;
      }
      await ingestLocaleFile(data, skipped, full, codeRoot);
      continue;
    }

    if (entry.isDirectory() && LOCALE_DIRNAME_PATTERN.test(entry.name)) {
      const locale = entry.name;
      const subEntries = readdirSync(full, { withFileTypes: true });
      for (const sub of subEntries) {
        if (!sub.isFile() || !sub.name.endsWith(".lua")) continue;
        const subFull = path.join(full, sub.name);
        await ingestSubdirLocaleFile(data, skipped, subFull, locale, codeRoot);
      }
    }
  }

  return { data, skipped };
}

async function ingestLocaleFile(
  data: LocaleData,
  skipped: Set<SkipReason>,
  fullPath: string,
  codeRoot: string,
): Promise<void> {
  const content = await Bun.file(fullPath).text();
  const parsed = parseLocaleFile(content, fullPath);
  for (const reason of parsed.skipped) skipped.add(reason);
  if (!parsed.locale) return;
  mergeKeys(data, parsed.locale, parsed.keys, fullPath, codeRoot);
}

async function ingestSubdirLocaleFile(
  data: LocaleData,
  skipped: Set<SkipReason>,
  fullPath: string,
  locale: string,
  codeRoot: string,
): Promise<void> {
  const content = await Bun.file(fullPath).text();
  const { keys, skipped: fileSkipped } = parseKeyTable(content);
  for (const reason of fileSkipped) skipped.add(reason);
  mergeKeys(data, locale, keys, fullPath, codeRoot);
}

function mergeKeys(
  data: LocaleData,
  locale: string,
  keys: Map<string, number>,
  fullPath: string,
  codeRoot: string,
): void {
  const existing = data.get(locale) ?? new Map<string, KeyLocation>();
  const relFile = path.relative(codeRoot, fullPath) || fullPath;
  for (const [key, line] of keys) {
    if (!existing.has(key)) existing.set(key, { file: relFile, line });
  }
  data.set(locale, existing);
}

// ---------------------------------------------------------------------------
// Reference scanner
// ---------------------------------------------------------------------------

const RG_REFERENCE_PATTERN = "L\\[[^\\]\\n]+\\]";
const REF_KEY_EXTRACTOR = /L\[\s*"([^"]+)"\s*\]|L\[\s*'([^']+)'\s*\]/g;
const REF_DYNAMIC_DETECTOR = /L\[\s*[A-Za-z_]\w*\s*\]/;

export async function scanReferences(
  codeRoot: string,
): Promise<{ refs: RefMap; skipped: Set<SkipReason> }> {
  const refs: RefMap = new Map();
  const skipped = new Set<SkipReason>();

  let out = "";
  try {
    out = await runRg([
      "--no-heading",
      "--line-number",
      RG_REFERENCE_PATTERN,
      codeRoot,
      ...RG_GLOBS,
    ]);
  } catch {
    return { refs, skipped };
  }
  if (!out) return { refs, skipped };

  for (const row of out.split("\n")) {
    const m = /^(.+?):(\d+):(.*)$/.exec(row);
    if (!m) continue;
    const file = path.relative(codeRoot, m[1]) || m[1];
    const line = parseInt(m[2], 10);
    const content = m[3];

    // Skip single-line `--` comments (block-comment `--[[ ]]` is out of scope).
    if (content.trimStart().startsWith("--")) continue;

    let matchedString = false;
    REF_KEY_EXTRACTOR.lastIndex = 0;
    let km: RegExpExecArray | null;
    while ((km = REF_KEY_EXTRACTOR.exec(content)) !== null) {
      const key = km[1] ?? km[2];
      const arr = refs.get(key) ?? [];
      arr.push({ file, line });
      refs.set(key, arr);
      matchedString = true;
    }
    if (!matchedString && REF_DYNAMIC_DETECTOR.test(content)) {
      skipped.add("dynamic-reference");
    }
  }

  return { refs, skipped };
}

// ---------------------------------------------------------------------------
// Findings computation (pure)
// ---------------------------------------------------------------------------

export function selectBaseLocale(locales: readonly string[]): string {
  if (locales.includes("enUS")) return "enUS";
  for (const candidate of CANONICAL_LOCALE_ORDER) {
    if (locales.includes(candidate)) return candidate;
  }
  return [...locales].sort()[0];
}

export function computeMissing(
  baseLocale: string,
  data: LocaleData,
): Findings["missing"] {
  const baseKeys = data.get(baseLocale);
  if (!baseKeys) return [];
  const missing: Findings["missing"] = [];
  for (const [locale, keys] of data) {
    if (locale === baseLocale) continue;
    for (const [key, location] of baseKeys) {
      if (!keys.has(key)) {
        missing.push({
          locale,
          key,
          baseFile: location.file,
          baseLine: location.line,
        });
      }
    }
  }
  return missing;
}

export function computeUnused(
  baseLocale: string,
  data: LocaleData,
  refs: RefMap,
): Findings["unused"] {
  const baseKeys = data.get(baseLocale);
  if (!baseKeys) return [];
  const unused: Findings["unused"] = [];
  for (const [key, location] of baseKeys) {
    if (!refs.has(key)) {
      unused.push({ key, file: location.file, line: location.line });
    }
  }
  return unused;
}

export function computeUndefined(
  baseLocale: string,
  data: LocaleData,
  refs: RefMap,
): Findings["undefinedRefs"] {
  const baseKeys = data.get(baseLocale) ?? new Map<string, KeyLocation>();
  const undefinedRefs: Findings["undefinedRefs"] = [];
  for (const [key, list] of refs) {
    if (!baseKeys.has(key)) {
      const first = list[0];
      undefinedRefs.push({ key, file: first.file, line: first.line });
    }
  }
  return undefinedRefs;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderMissingSection(missing: Findings["missing"]): string {
  if (missing.length === 0) return "";
  const byLocale = new Map<string, string[]>();
  for (const { locale, key } of missing) {
    const arr = byLocale.get(locale) ?? [];
    arr.push(key);
    byLocale.set(locale, arr);
  }
  const blocks: string[] = [`### Missing Keys (${missing.length})`];
  const sortedLocales = [...byLocale.keys()].sort();
  for (const locale of sortedLocales) {
    const keys = byLocale.get(locale)!;
    blocks.push(
      `**${locale}** (${keys.length} missing):\n` +
        keys.map((k) => `- \`${k}\``).join("\n"),
    );
  }
  return blocks.join("\n\n");
}

function renderUnusedSection(unused: Findings["unused"]): string {
  if (unused.length === 0) return "";
  const lines = [`### Unused Keys (${unused.length})`, ""];
  for (const u of unused) {
    lines.push(`- \`${u.key}\` — defined in \`${u.file}:${u.line}\``);
  }
  return lines.join("\n");
}

function renderUndefinedSection(refs: Findings["undefinedRefs"]): string {
  if (refs.length === 0) return "";
  const lines = [`### Undefined Keys (${refs.length})`, ""];
  for (const r of refs) {
    lines.push(`- \`${r.key}\` — referenced in \`${r.file}:${r.line}\``);
  }
  return lines.join("\n");
}

function renderResultBody(
  findings: Findings,
  baseLocale: string,
  baseKeyCount: number,
  localeCount: number,
): string {
  const allEmpty =
    findings.missing.length === 0 &&
    findings.unused.length === 0 &&
    findings.undefinedRefs.length === 0;
  if (allEmpty) {
    return `All locales consistent. ${baseKeyCount} keys checked across ${localeCount} locales.`;
  }
  const sections = [
    renderMissingSection(findings.missing),
    renderUnusedSection(findings.unused),
    renderUndefinedSection(findings.undefinedRefs),
  ].filter((s) => s.length > 0);
  return sections.join("\n\n");
}

function renderSkipNotes(skipped: Set<SkipReason>): string | undefined {
  if (skipped.size === 0) return undefined;
  const lines = [...skipped].map((r) => `- ${SKIP_REASON_TEXT[r]}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Locale summary helpers
// ---------------------------------------------------------------------------

function formatLocalesFound(data: LocaleData): string {
  const entries = [...data.entries()].map(
    ([locale, keys]) => ({ locale, count: keys.size }),
  );
  entries.sort((a, b) => {
    const orderA = CANONICAL_LOCALE_ORDER.indexOf(a.locale);
    const orderB = CANONICAL_LOCALE_ORDER.indexOf(b.locale);
    const rankA = orderA === -1 ? Number.MAX_SAFE_INTEGER : orderA;
    const rankB = orderB === -1 ? Number.MAX_SAFE_INTEGER : orderB;
    if (rankA !== rankB) return rankA - rankB;
    return a.locale.localeCompare(b.locale);
  });
  return entries.map((e) => `${e.locale} (${e.count})`).join(", ");
}

function formatCodeReferences(refs: RefMap): string {
  const fileSet = new Set<string>();
  for (const list of refs.values()) {
    for (const r of list) fileSet.add(r.file);
  }
  return `${refs.size} unique keys across ${fileSet.size} files`;
}

// ---------------------------------------------------------------------------
// Mode handlers
// ---------------------------------------------------------------------------

async function runMultiFileMode(
  resolution: Extract<Resolution, { mode: "addon-root" | "locales-only" }>,
): Promise<string> {
  const { localesDir, codeRoot, displayLabel, mode } = resolution;
  const { data, skipped } = await gatherLocales(localesDir, codeRoot);

  if (data.size === 0) {
    return renderNoMatch({
      title: TITLES.localeCheck,
      metadata: [
        ["Target", displayLabel],
        ["Mode", mode],
      ],
      paragraph:
        "No locale files were discovered under the resolved Locales directory.",
      suggestions: [
        "Verify the target path contains a `Locales/` directory or matches a `<lang><region>.lua` pattern.",
        "Check that locale files use the convention `enUS.lua`, `deDE.lua`, etc.",
      ],
    });
  }

  const locales = [...data.keys()];
  const baseLocale = selectBaseLocale(locales);
  const baseKeys = data.get(baseLocale)!;

  const { refs, skipped: refSkipped } = await scanReferences(codeRoot);
  for (const r of refSkipped) skipped.add(r);

  const findings: Findings = {
    missing: computeMissing(baseLocale, data),
    unused: computeUnused(baseLocale, data, refs),
    undefinedRefs: computeUndefined(baseLocale, data, refs),
  };

  const metadata: MetadataPair[] = [
    ["Target", displayLabel],
    ["Mode", mode],
    ["Base Locale", baseLocale],
    ["Locales Found", formatLocalesFound(data)],
    ["Code References", formatCodeReferences(refs)],
  ];

  return renderReport({
    title: TITLES.localeCheck,
    metadata,
    body: {
      outcome: "result",
      body: renderResultBody(findings, baseLocale, baseKeys.size, data.size),
    },
    notes: renderSkipNotes(skipped),
  });
}

async function runSingleFileMode(
  resolution: Extract<Resolution, { mode: "single-file" }>,
): Promise<string> {
  const { file, displayLabel } = resolution;
  const content = await Bun.file(file).text();
  const parsed = parseLocaleFile(content, file);

  const localeLabel = parsed.locale || "(non-standard filename)";
  const skipNotes = parsed.skipped.length > 0
    ? "### Skipped\n\n" +
      parsed.skipped.map((r) => `- ${SKIP_REASON_TEXT[r]}`).join("\n")
    : "";

  const bodyParts = [
    `### Locale: ${localeLabel}`,
    `${parsed.keys.size} keys parsed.`,
  ];
  if (skipNotes) bodyParts.push(skipNotes);

  return renderReport({
    title: TITLES.localeCheck,
    metadata: [
      ["Target", displayLabel],
      ["Mode", "single-file"],
    ],
    body: { outcome: "result", body: bodyParts.join("\n\n") },
    notes:
      "Cross-file checks skipped — pass an addon root or `Locales/` directory for full analysis.",
  });
}

// ---------------------------------------------------------------------------
// Project-scan integration: thin locale summary
// ---------------------------------------------------------------------------

export interface LocaleSummary {
  readonly baseLocale: string | null;
  readonly locales: ReadonlyArray<{
    readonly name: string;
    readonly keyCount: number;
  }>;
  readonly skipped: readonly SkipReason[];
}

const EMPTY_SUMMARY: LocaleSummary = {
  baseLocale: null,
  locales: [],
  skipped: [],
};

/**
 * Project-x-ray projection over the same data the cross-locale check
 * computes: locale list with key counts and base-locale election. No
 * reference scanning, no missing/unused/undefined arithmetic — those stay
 * in the dedicated tool. When `addonRoot` does not resolve to a layout
 * containing locale files, the summary is empty rather than an error;
 * project-scan reports "no locales found" rather than failing.
 */
export async function summariseLocales(
  addonRoot: string,
): Promise<LocaleSummary> {
  const resolution = resolveTarget(addonRoot);
  if (resolution.mode !== "addon-root" && resolution.mode !== "locales-only") {
    return EMPTY_SUMMARY;
  }

  const { data, skipped } = await gatherLocales(
    resolution.localesDir,
    resolution.codeRoot,
  );
  if (data.size === 0) return { ...EMPTY_SUMMARY, skipped: [...skipped] };

  const baseLocale = selectBaseLocale([...data.keys()]);
  const locales = [...data.entries()]
    .map(([name, keys]) => ({ name, keyCount: keys.size }))
    .sort((a, b) => {
      const orderA = CANONICAL_LOCALE_ORDER.indexOf(a.name);
      const orderB = CANONICAL_LOCALE_ORDER.indexOf(b.name);
      const rankA = orderA === -1 ? Number.MAX_SAFE_INTEGER : orderA;
      const rankB = orderB === -1 ? Number.MAX_SAFE_INTEGER : orderB;
      if (rankA !== rankB) return rankA - rankB;
      return a.name.localeCompare(b.name);
    });

  return { baseLocale, locales, skipped: [...skipped] };
}

// ---------------------------------------------------------------------------
// Tool export
// ---------------------------------------------------------------------------

export default tool({
  description:
    "Cross-file consistency check for WoW addon locale tables.\n\n" +
    "Compares keys across `<lang><region>.lua` files under a `Locales/` directory and surfaces three bug classes: missing translations (key in base locale but absent from another), unused keys (defined in base locale but never referenced in code), and undefined references (`L[\"key\"]` in code with no definition in the base locale).\n\n" +
    "Usage:\n" +
    "- `target` accepts either an addon root containing `Locales/`, a `Locales/` directory directly, or a single `<lang><region>.lua` file (degraded mode — parses keys only, no cross-file checks).\n" +
    "- Base locale defaults to `enUS` when present; otherwise the first locale in WoW canonical order; otherwise alphabetical.\n" +
    "- Out of scope: hardcoded English string detection, AceLocale `:NewLocale` parsing, dynamic key shapes (`L[var]`, concatenated keys, multi-line strings), block-comment handling.",
  args: {
    target: tool.schema
      .string()
      .describe(
        "Path to an addon root directory (containing `Locales/`), a `Locales/` directory directly, or a single locale `.lua` file. Absolute, `~`-prefixed, or relative to CWD.",
      ),
  },
  async execute(args) {
    const { target } = args;
    const trimmedTarget = target.trim();

    if (!trimmedTarget) {
      return renderError({
        title: TITLES.localeCheck,
        metadata: [["Target", "(empty)"]],
        reason: "`target` must not be empty.",
        cause: "(no input provided)",
        suggestions: [
          "Pass an addon root directory containing `Locales/`.",
          "Or pass a `Locales/` directory directly.",
          "Or pass a single `<lang><region>.lua` file for parse-only mode.",
        ],
      });
    }

    const resolution = resolveTarget(trimmedTarget);

    if (resolution.mode === "error") {
      return renderError({
        title: TITLES.localeCheck,
        metadata: [["Target", trimmedTarget]],
        reason: "Could not resolve target to a recognised locale layout.",
        cause: resolution.reason,
        suggestions: [
          "Verify the path exists and is readable.",
          "Pass an addon root containing `Locales/`, a `Locales/` directory directly, or a single `<lang><region>.lua` file.",
        ],
      });
    }

    try {
      if (resolution.mode === "single-file") {
        return await runSingleFileMode(resolution);
      }
      return await runMultiFileMode(resolution);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return renderError({
        title: TITLES.localeCheck,
        metadata: [
          ["Target", trimmedTarget],
          ["Mode", resolution.mode],
        ],
        reason: "Locale check failed.",
        cause: message,
        suggestions: [
          "Verify ripgrep (`rg`) is installed and on PATH.",
          "Verify all locale files are readable.",
        ],
      });
    }
  },
});
