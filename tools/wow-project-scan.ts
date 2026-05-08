// tools/wow-project-scan.ts
//
// Project-aware addon scanner. Walks an addon root, parses every top-level
// `*.toc`, optionally aggregates a lint roll-up, and produces a structural
// "x-ray" of the project. See ADR `wave3-feature1-project-scan.md` for the
// full design rationale.
//
// Modes (default `summary`):
//   summary     – identity card; cheap.
//   toc         – per-TOC breakdown with directives + conditional summary.
//   files       – orphaned vs referenced inventory.
//   libs        – embedded library detection.
//   lint-rollup – cross-file lint findings, aggregated by category and rule.

import { tool } from "@opencode-ai/plugin";
import os from "node:os";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import {
  renderError,
  renderNoMatch,
  renderReport,
  runRg,
  safeReadDir,
  TITLES,
  type MetadataPair,
} from "./_shared";
import {
  parseToc,
  tocFilesIn,
  type FlavorFilter,
  type ParsedToc,
  type TocFlavor,
} from "./_toc";
import { runLintRules, type LintFinding } from "./wow-addon-lint";
import { summariseLocales, type LocaleSummary } from "./wow-locale-check";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = "summary" | "toc" | "files" | "libs" | "lint-rollup";

type Resolution =
  | { readonly mode: "ok"; readonly root: string; readonly displayLabel: string }
  | { readonly mode: "multi"; readonly candidates: readonly string[] }
  | { readonly mode: "error"; readonly reason: string };

interface FileInventory {
  readonly lua: readonly string[]; // project-relative
  readonly xml: readonly string[];
  readonly all: readonly string[];
}

interface LibraryInfo {
  readonly name: string;
  readonly version: string;
  readonly source: "Libs/" | "embeds.xml" | "heuristic";
  readonly directory: string; // project-relative
  readonly referencedByToc: boolean;
}

interface ProjectModel {
  readonly addonRoot: string;
  readonly displayLabel: string;
  readonly flavorFilter: FlavorFilter;
  readonly tocs: readonly ParsedToc[];
  readonly files: FileInventory;
  readonly libs: readonly LibraryInfo[];
  readonly locales: LocaleSummary;
  readonly referencedLuaAbsolute: readonly string[]; // for lint-rollup
  readonly orphans: readonly string[];
  readonly referenced: readonly string[];
  readonly perFlavorRefs: ReadonlyMap<TocFlavor, ReadonlySet<string>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEPTH_LIMIT = 8;
const RG_IGNORE_GLOBS: readonly string[] = [
  "-g",
  "!**/.git/**",
  "-g",
  "!**/.svn/**",
  "-g",
  "!**/node_modules/**",
];

const LIBRARY_DIR_NAMES = new Set([
  "libs",
  "libraries",
  "lib",
  "embeds",
  "external",
]);

const MULTI_ADDON_CANDIDATE_CAP = 20;

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

function toRel(addonRoot: string, absOrRel: string): string {
  if (!path.isAbsolute(absOrRel)) return absOrRel;
  const rel = path.relative(addonRoot, absOrRel);
  return rel === "" ? "." : rel;
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

function resolveAddonRoot(target: string): Resolution {
  const trimmed = target.trim();
  if (!trimmed) return { mode: "error", reason: "Empty target." };

  const resolved = expandHome(trimmed);
  if (!existsSync(resolved)) {
    return { mode: "error", reason: `Path does not exist: ${trimmed}` };
  }

  const stat = statSync(resolved);
  if (stat.isFile()) {
    return {
      mode: "error",
      reason:
        "Target must be a directory; for single-file analysis use `wow-addon-lint` or `wow-locale-check`.",
    };
  }
  if (!stat.isDirectory()) {
    return {
      mode: "error",
      reason: "Target is neither a directory nor a regular file.",
    };
  }

  // Top-level TOC present → addon root.
  if (tocFilesIn(resolved).length > 0) {
    return { mode: "ok", root: resolved, displayLabel: trimmed };
  }

  // Multi-addon workspace? Direct subdirectories carrying their own TOC.
  const candidates = enumerateAddonCandidates(resolved);
  if (candidates.length > 0) {
    return { mode: "multi", candidates };
  }

  return {
    mode: "error",
    reason:
      "No `*.toc` at the addon root and no candidate addon subdirectories detected.",
  };
}

function enumerateAddonCandidates(root: string): string[] {
  const entries = safeReadDir(root);
  if (entries === null) return [];
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    const sub = path.join(root, e.name);
    if (tocFilesIn(sub).length > 0) out.push(sub);
  }
  out.sort();
  return out;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function discoverTocs(
  root: string,
  flavorFilter: FlavorFilter,
): Promise<ParsedToc[]> {
  const paths = tocFilesIn(root);
  const parsed: ParsedToc[] = [];
  for (const p of paths) {
    const source = await Bun.file(p).text();
    parsed.push(parseToc(source, p, flavorFilter));
  }
  return parsed;
}

async function discoverFiles(root: string): Promise<FileInventory> {
  const raw = await runRgFiles(root);
  if (!raw) return { lua: [], xml: [], all: [] };

  const all: string[] = [];
  const lua: string[] = [];
  const xml: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const rel = toRel(root, line);
    all.push(rel);
    if (rel.endsWith(".lua")) lua.push(rel);
    else if (rel.endsWith(".xml")) xml.push(rel);
  }
  all.sort();
  lua.sort();
  xml.sort();
  return { lua, xml, all };
}

/**
 * `runRg --files` lifted into its own helper so the failure-path branch
 * isn't tangled with the parsing loop above. Returns the empty string on
 * any rg failure (missing binary, depth excess, permission errors); the
 * caller treats that the same as a no-files result.
 */
async function runRgFiles(root: string): Promise<string> {
  try {
    return await runRg([
      "--files",
      "--max-depth",
      String(DEPTH_LIMIT),
      ...RG_IGNORE_GLOBS,
      root,
    ]);
  } catch {
    return "";
  }
}

async function discoverLibraries(
  root: string,
  referenced: ReadonlySet<string>,
): Promise<LibraryInfo[]> {
  const entries = safeReadDir(root);
  if (entries === null) return [];

  const libs: LibraryInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!LIBRARY_DIR_NAMES.has(e.name.toLowerCase())) continue;
    const libDir = path.join(root, e.name);
    libs.push(...(await collectLibsFromDir(libDir, root, referenced)));
  }

  return libs;
}

async function collectLibsFromDir(
  libDir: string,
  addonRoot: string,
  referenced: ReadonlySet<string>,
): Promise<LibraryInfo[]> {
  const entries = safeReadDir(libDir);
  if (entries === null) return [];

  const out: LibraryInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(libDir, e.name);
    out.push(await readLibraryDir(dir, addonRoot, referenced));
  }
  return out;
}

async function readLibraryToc(
  tocPath: string,
): Promise<{ title: string | null; version: string | null }> {
  const source = await Bun.file(tocPath).text();
  const parsed = parseToc(source, tocPath, "all");
  return { title: parsed.title, version: parsed.version };
}

async function readLibraryDir(
  dir: string,
  addonRoot: string,
  referenced: ReadonlySet<string>,
): Promise<LibraryInfo> {
  const dirRel = toRel(addonRoot, dir);
  const tocFiles = tocFilesIn(dir);
  const meta = tocFiles.length > 0
    ? await readLibraryToc(tocFiles[0])
    : { title: null as string | null, version: null as string | null };

  const isReferenced = [...referenced].some((ref) =>
    ref.startsWith(dirRel + path.sep) || ref === dirRel,
  );

  return {
    name: meta.title ?? path.basename(dir),
    version: meta.version ?? "(unknown)",
    source: "Libs/",
    directory: dirRel,
    referencedByToc: isReferenced,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function buildReferencedSet(
  tocs: readonly ParsedToc[],
  addonRoot: string,
): {
  referenced: Set<string>;
  perFlavor: Map<TocFlavor, Set<string>>;
  referencedLuaAbsolute: string[];
} {
  const referenced = new Set<string>();
  const perFlavor = new Map<TocFlavor, Set<string>>();
  // Deduplicate absolute paths: when multiple TOCs reference the same `.lua`
  // file (the common case for a default + mainline split), we still only
  // want to lint each file once.
  const referencedLuaAbsoluteSet = new Set<string>();

  for (const toc of tocs) {
    const tocDir = path.dirname(toc.path);
    const set = perFlavor.get(toc.flavor) ?? new Set<string>();
    for (const ref of toc.fileRefs) {
      // TOC paths use Windows-style backslashes routinely; normalise to
      // POSIX so the orphan-comparison set lines up with `rg --files`
      // output.
      const normalised = ref.path.replace(/\\/g, "/");
      const abs = path.resolve(tocDir, normalised);
      const rel = toRel(addonRoot, abs);
      referenced.add(rel);
      set.add(rel);
      if (rel.endsWith(".lua")) referencedLuaAbsoluteSet.add(abs);
    }
    perFlavor.set(toc.flavor, set);
  }

  return {
    referenced,
    perFlavor,
    referencedLuaAbsolute: [...referencedLuaAbsoluteSet].sort(),
  };
}

function computeOrphans(
  inventory: FileInventory,
  referenced: ReadonlySet<string>,
): string[] {
  const orphans: string[] = [];
  for (const file of [...inventory.lua, ...inventory.xml]) {
    if (referenced.has(file)) continue;
    if (isInsideExcludedTree(file)) continue;
    orphans.push(file);
  }
  orphans.sort();
  return orphans;
}

function isInsideExcludedTree(rel: string): boolean {
  const head = rel.split(path.sep)[0]?.toLowerCase() ?? "";
  return LIBRARY_DIR_NAMES.has(head) || head === "locales";
}

// ---------------------------------------------------------------------------
// Lint roll-up driver
// ---------------------------------------------------------------------------

async function collectLintFindings(
  referencedLuaAbsolute: readonly string[],
): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  await Promise.all(
    referencedLuaAbsolute.map(async (abs) => {
      const file = Bun.file(abs);
      if (!(await file.exists())) return;
      const source = await file.text();
      const out = await runLintRules(abs, source, { enrich: false });
      findings.push(...out);
    }),
  );
  return findings;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderSummary(model: ProjectModel): string {
  const tocs = model.tocs;
  const interfaces = tocs
    .filter((t) => t.interface !== null)
    .map((t) => `${t.interface} (${t.flavor})`)
    .join(", ");
  const sv = unique(tocs.flatMap((t) => t.savedVariables));
  const svp = unique(tocs.flatMap((t) => t.savedVariablesPerCharacter));
  const deps = unique(tocs.flatMap((t) => t.dependencies));
  const odeps = unique(tocs.flatMap((t) => t.optionalDeps));

  const luaCount = model.files.lua.length;
  const xmlCount = model.files.xml.length;
  const orphanLua = model.orphans.filter((f) => f.endsWith(".lua")).length;
  const orphanXml = model.orphans.filter((f) => f.endsWith(".xml")).length;

  const localeLine =
    model.locales.locales.length > 0
      ? model.locales.locales.map((l) => `${l.name} (${l.keyCount})`).join(", ")
      : "(none found)";

  const sections = [
    "### Identity",
    bullet("Title", firstNonNull(tocs.map((t) => t.title)) ?? "(unset)"),
    bullet("Version", firstNonNull(tocs.map((t) => t.version)) ?? "(unset)"),
    bullet("Author", firstNonNull(tocs.map((t) => t.author)) ?? "(unset)"),
    bullet("Interfaces", interfaces || "(none)"),
    "",
    "### Loading",
    bullet("Dependencies", deps.join(", ") || "(none)"),
    bullet("Optional Deps", odeps.join(", ") || "(none)"),
    bullet("SavedVariables", sv.join(", ") || "(none)"),
    bullet("SavedVariablesPerCharacter", svp.join(", ") || "(none)"),
    "",
    "### Inventory",
    bullet(
      "Lua files",
      `${luaCount} (${luaCount - orphanLua} referenced, ${orphanLua} orphaned)`,
    ),
    bullet(
      "XML files",
      `${xmlCount} (${xmlCount - orphanXml} referenced, ${orphanXml} orphaned)`,
    ),
    bullet(
      "Embedded libraries",
      model.libs.length === 0
        ? "(none detected)"
        : `${model.libs.length} (${model.libs.map((l) => l.name).join(", ")})`,
    ),
    bullet("Locales", localeLine),
    "",
    "### Pointers",
    "- Run with `mode: \"toc\"` for per-TOC directive breakdown.",
    "- Run with `mode: \"files\"` to list orphaned files.",
    "- Run with `mode: \"libs\"` for library detection details.",
    "- Run with `mode: \"lint-rollup\"` for cross-file lint findings.",
  ];
  return sections.join("\n");
}

function renderToc(model: ProjectModel): string {
  if (model.tocs.length === 0) return "(no TOC files parsed)";
  const blocks: string[] = [];
  for (const toc of model.tocs) {
    const rel = toRel(model.addonRoot, toc.path);
    const conditionalSummary =
      toc.conditionals.length === 0
        ? "(none)"
        : toc.conditionals
            .map(
              (c) =>
                `${c.negated ? "#@non-" : "#@"}${c.tag}@ (${c.lines.length} lines, ${c.active ? "active" : "inactive"})`,
            )
            .join(", ");
    blocks.push(
      `### ${rel} (${toc.flavor}${toc.interface ? `, Interface ${toc.interface}` : ""})`,
      bullet("Directives", String(toc.directives.length)),
      bullet("File refs", String(toc.fileRefs.length)),
      bullet(
        "SavedVariables",
        toc.savedVariables.join(", ") || "(none)",
      ),
      bullet("Dependencies", toc.dependencies.join(", ") || "(none)"),
      bullet("Optional Deps", toc.optionalDeps.join(", ") || "(none)"),
      bullet("Conditional blocks", conditionalSummary),
      "",
    );
  }
  return blocks.join("\n").trimEnd();
}

function renderFiles(model: ProjectModel): string {
  const sections: string[] = [];

  if (model.orphans.length > 0) {
    sections.push(`### Orphaned Files (${model.orphans.length})`, "");
    for (const f of model.orphans) sections.push(`- \`${f}\``);
    sections.push("");
  } else {
    sections.push("### Orphaned Files (0)", "", "(none)", "");
  }

  sections.push(`### Referenced Files (${model.referenced.length})`);
  if (model.referenced.length === 0) {
    sections.push("", "(none)");
    return sections.join("\n");
  }

  // Group referenced files by which flavors load them.
  const flavors = [...model.perFlavorRefs.keys()].sort();
  if (flavors.length === 1) {
    sections.push("");
    for (const f of model.referenced) sections.push(`- \`${f}\``);
    return sections.join("\n");
  }

  const buckets = bucketByFlavorCoverage(model.referenced, model.perFlavorRefs);
  for (const [label, files] of buckets) {
    sections.push("", `**${label} (${files.length}):**`);
    for (const f of files) sections.push(`- \`${f}\``);
  }
  return sections.join("\n");
}

function renderLibs(model: ProjectModel): string {
  if (model.libs.length === 0) return "(no embedded libraries detected)";
  const rows = [
    "| Name | Version | Source | Directory | Referenced |",
    "|------|---------|--------|-----------|------------|",
  ];
  for (const lib of model.libs) {
    rows.push(
      `| ${lib.name} | ${lib.version} | ${lib.source} | \`${lib.directory}\` | ${lib.referencedByToc ? "yes" : "no"} |`,
    );
  }
  const dead = model.libs.filter((l) => !l.referencedByToc);
  const sections = [`### Libraries (${model.libs.length})`, "", ...rows];
  if (dead.length > 0) {
    sections.push(
      "",
      `### Unreferenced Libraries (${dead.length})`,
      "",
      "These libraries are present on disk but not loaded by any TOC. Likely dead code.",
      "",
      ...dead.map((l) => `- \`${l.directory}\` (${l.name})`),
    );
  }
  return sections.join("\n");
}

function renderLintRollup(
  model: ProjectModel,
  findings: readonly LintFinding[],
): string {
  if (model.referencedLuaAbsolute.length === 0) {
    return "(no TOC-referenced .lua files to lint)";
  }
  if (findings.length === 0) {
    return `### Findings Summary\n\nNo issues found across ${model.referencedLuaAbsolute.length} files.`;
  }

  const byCategory = new Map<string, { count: number; files: Set<string> }>();
  const byRule = new Map<string, number>();
  const byFile = new Map<string, number>();

  for (const f of findings) {
    const fileRel = toRel(model.addonRoot, f.file ?? "");
    const cat = byCategory.get(f.category) ?? { count: 0, files: new Set() };
    cat.count++;
    cat.files.add(fileRel);
    byCategory.set(f.category, cat);
    const ruleKey = `${f.category}/${shortRuleId(f.message)}`;
    byRule.set(ruleKey, (byRule.get(ruleKey) ?? 0) + 1);
    byFile.set(fileRel, (byFile.get(fileRel) ?? 0) + 1);
  }

  const filesScanned = model.referencedLuaAbsolute.length;
  const sections: string[] = [
    `### Findings Summary (${findings.length} total across ${byFile.size}/${filesScanned} files)`,
    "",
    "| Category | Count | Files |",
    "|----------|-------|-------|",
    ...[...byCategory.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(
        ([cat, info]) => `| ${cat} | ${info.count} | ${info.files.size} |`,
      ),
    "",
    "### Top Rules",
    "",
    ...[...byRule.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([rule, count], i) => `${i + 1}. \`${rule}\` — ${count} occurrences`),
    "",
    "### Per-File Counts (top 10)",
    "",
    ...[...byFile.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => `- \`${file}\` — ${count} findings`),
    "",
    "Run `wow-addon-lint` on a specific file for full per-line detail.",
  ];
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function bullet(key: string, value: string): string {
  return `- **${key}:** ${value}`;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function firstNonNull<T>(values: readonly (T | null)[]): T | null {
  for (const v of values) if (v !== null) return v;
  return null;
}

function shortRuleId(message: string): string {
  // Stable, human-readable rule slug derived from the finding's message.
  // Identifier-like tokens (e.g. `UnitName`, `string.format`) are preserved
  // wholesale so similar messages share a rule key; the rest collapses to
  // dashes. Truncated to 60 chars so absurd messages don't dominate the
  // table.
  return message
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
}

function bucketByFlavorCoverage(
  referenced: readonly string[],
  perFlavor: ReadonlyMap<TocFlavor, ReadonlySet<string>>,
): Array<[label: string, files: string[]]> {
  const flavors = [...perFlavor.keys()].sort();
  const groups = new Map<string, string[]>();

  for (const file of referenced) {
    const loadedBy = flavors.filter((fl) => perFlavor.get(fl)!.has(file));
    const label =
      loadedBy.length === flavors.length
        ? "Loaded by all TOCs"
        : `Loaded by ${loadedBy.join(", ")}`;
    const arr = groups.get(label) ?? [];
    arr.push(file);
    groups.set(label, arr);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// ---------------------------------------------------------------------------
// Body dispatch
// ---------------------------------------------------------------------------

async function renderBody(
  mode: Mode,
  model: ProjectModel,
): Promise<string> {
  if (mode === "summary") return renderSummary(model);
  if (mode === "toc") return renderToc(model);
  if (mode === "files") return renderFiles(model);
  if (mode === "libs") return renderLibs(model);
  const findings = await collectLintFindings(model.referencedLuaAbsolute);
  return renderLintRollup(model, findings);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function buildNotes(model: ProjectModel): string | undefined {
  const lines: string[] = [];

  // Conditional-block clarification (only when present and the user picked
  // the default `all` filter — Curseforge-packager semantics inline every
  // block, which is non-obvious and worth surfacing).
  const conditionalCount = model.tocs.reduce(
    (n, t) => n + t.conditionals.length,
    0,
  );
  if (conditionalCount > 0 && model.flavorFilter === "all") {
    lines.push(
      `Conditional blocks present (${conditionalCount} total). Under \`flavor: "all"\` every block is treated as active (Curseforge-packager semantics — the union of all flavors).`,
    );
  } else if (conditionalCount > 0) {
    lines.push(
      `Conditional blocks present (${conditionalCount} total). Filtered by flavor \`${model.flavorFilter}\`; inactive blocks are recorded but their file refs are excluded.`,
    );
  }

  // Locale skip reasons
  if (model.locales.skipped.length > 0) {
    lines.push(
      `Locale parser skipped: ${model.locales.skipped.join(", ")}.`,
    );
  }

  // Parse warnings from any TOC
  for (const toc of model.tocs) {
    if (toc.parseWarnings.length === 0) continue;
    const rel = toRel(model.addonRoot, toc.path);
    for (const w of toc.parseWarnings) lines.push(`\`${rel}\`: ${w}`);
  }

  return lines.length === 0 ? undefined : lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool body
// ---------------------------------------------------------------------------

function noMatchMultiAddon(
  trimmedTarget: string,
  candidates: readonly string[],
  workspaceRoot: string,
): string {
  const cap = MULTI_ADDON_CANDIDATE_CAP;
  const shown = candidates.slice(0, cap);
  const overflow = candidates.length - shown.length;

  const candidateLines = shown
    .map((c) => `- \`${toRel(workspaceRoot, c)}\``)
    .join("\n");
  const overflowSuffix = overflow > 0 ? `\n- (${overflow} more)` : "";

  return renderNoMatch({
    title: TITLES.projectScan,
    metadata: [
      ["Target", trimmedTarget],
      ["Resolution", "multi-addon workspace"],
    ],
    paragraph: `No \`*.toc\` at the target root, but ${candidates.length} candidate addon ${candidates.length === 1 ? "directory" : "directories"} detected. Run the tool on each individually:\n\n${candidateLines}${overflowSuffix}`,
    suggestions: [
      "Re-invoke `wow-project-scan` with one of the candidate paths above.",
      "If your addon root is at a different depth, narrow `target` to the directory that owns the `.toc` file.",
    ],
  });
}

function metadataFor(
  model: ProjectModel,
  mode: Mode,
): MetadataPair[] {
  const flavorList = unique(model.tocs.map((t) => t.flavor)).join(", ");
  const tocCount = model.tocs.length;
  const identity = firstNonNull(model.tocs.map((t) => t.title)) ?? "(unknown)";
  const version = firstNonNull(model.tocs.map((t) => t.version));
  const tocSummary = tocCount === 0 ? "0" : `${tocCount} (${flavorList})`;

  return [
    ["Target", model.displayLabel],
    ["Mode", mode],
    ["Addon", version ? `${identity} (v${version})` : identity],
    ["Flavor Filter", model.flavorFilter],
    ["TOC Files", tocSummary],
  ];
}

// ---------------------------------------------------------------------------
// Tool export
// ---------------------------------------------------------------------------

export default tool({
  description:
    "Project-aware structural overview of a WoW addon directory. Walks the addon root, parses every top-level `.toc`, summarises identity / loading / inventory / locales / embedded libraries, and (optionally) rolls up a cross-file lint pass.\n\n" +
    "Modes:\n" +
    "- `summary` (default): identity card. Cheap.\n" +
    "- `toc`: per-TOC directive + conditional breakdown.\n" +
    "- `files`: orphaned vs referenced inventory, grouped by flavor.\n" +
    "- `libs`: embedded library detection with `(unreferenced)` flagging.\n" +
    "- `lint-rollup`: aggregate `wow-addon-lint` findings across every TOC-referenced `.lua`. Slow on large projects.\n\n" +
    "Out of scope: per-line lint (use `wow-addon-lint`), missing/unused locale keys (use `wow-locale-check`), API resolution (use `wow-api-lookup`), nested sub-addons.",
  args: {
    target: tool.schema
      .string()
      .describe(
        "Absolute, `~`-prefixed, or CWD-relative path to an addon root directory (one containing top-level `*.toc` files). A directory containing several addon subdirectories without its own TOC is reported as a multi-addon workspace.",
      ),
    mode: tool.schema
      .enum(["summary", "toc", "files", "libs", "lint-rollup"])
      .default("summary")
      .describe(
        "Scope of the report. `summary` is the cheap default; `lint-rollup` runs the full linter across every TOC-referenced .lua file and is the only mode allowed to be slow.",
      ),
    flavor: tool.schema
      .enum(["all", "mainline", "vanilla", "cata", "wrath", "tbc", "mists", "classic"])
      .default("all")
      .describe(
        "When multiple TOC variants exist, restrict the analysis to a single flavor. `all` (default) aggregates the union and treats every conditional block as active (Curseforge-packager semantics).",
      ),
  },
  async execute(args) {
    const { target, mode, flavor } = args;
    const trimmedTarget = target.trim();

    if (!trimmedTarget) {
      return renderError({
        title: TITLES.projectScan,
        metadata: [["Target", "(empty)"]],
        reason: "`target` must not be empty.",
        cause: "(no input provided)",
        suggestions: [
          "Pass a path to an addon root directory (one containing `.toc` files at the top level).",
        ],
      });
    }

    const resolution = resolveAddonRoot(trimmedTarget);
    if (resolution.mode === "error") {
      return renderError({
        title: TITLES.projectScan,
        metadata: [["Target", trimmedTarget]],
        reason: "Could not resolve target to an addon root.",
        cause: resolution.reason,
        suggestions: [
          "Verify the path exists and is a directory.",
          "Confirm the directory contains at least one top-level `*.toc` file.",
          "If you have a workspace of multiple addons, pass the path to a specific addon directory.",
        ],
      });
    }

    if (resolution.mode === "multi") {
      const workspaceRoot = expandHome(trimmedTarget);
      return noMatchMultiAddon(
        trimmedTarget,
        resolution.candidates,
        workspaceRoot,
      );
    }

    try {
      const model = await buildProjectModel(
        resolution.root,
        resolution.displayLabel,
        flavor,
      );
      if (model.tocs.length === 0) {
        return renderNoMatch({
          title: TITLES.projectScan,
          metadata: [
            ["Target", trimmedTarget],
            ["Mode", mode],
          ],
          paragraph:
            "No TOC files parsed at the addon root. Is this a WoW addon directory?",
          suggestions: [
            "Verify `*.toc` files exist at the top level (not just inside subdirectories).",
            "If only `Locales/` is present, use `wow-locale-check` instead.",
          ],
        });
      }

      const body = await renderBody(mode, model);
      return renderReport({
        title: TITLES.projectScan,
        metadata: metadataFor(model, mode),
        body: { outcome: "result", body },
        notes: buildNotes(model),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return renderError({
        title: TITLES.projectScan,
        metadata: [
          ["Target", trimmedTarget],
          ["Mode", mode],
        ],
        reason: "Project scan failed.",
        cause: message,
        suggestions: [
          "Verify ripgrep (`rg`) is installed and on PATH.",
          "Confirm filesystem permissions allow reading every file under the target.",
        ],
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Project model assembly
// ---------------------------------------------------------------------------

async function buildProjectModel(
  root: string,
  displayLabel: string,
  flavorFilter: FlavorFilter,
): Promise<ProjectModel> {
  const tocs = await discoverTocs(root, flavorFilter);
  const includeAllFlavors = flavorFilter === "all";
  const filtered = includeAllFlavors ? tocs : selectFlavorTocs(tocs, flavorFilter);

  const { referenced, perFlavor, referencedLuaAbsolute } = buildReferencedSet(
    filtered,
    root,
  );
  const [files, locales] = await Promise.all([
    discoverFiles(root),
    summariseLocales(root),
  ]);
  const libs = await discoverLibraries(root, referenced);

  const orphans = computeOrphans(files, referenced);

  return {
    addonRoot: root,
    displayLabel,
    flavorFilter,
    tocs: filtered,
    files,
    libs,
    locales,
    referencedLuaAbsolute,
    orphans,
    referenced: [...referenced].sort(),
    perFlavorRefs: perFlavor,
  };
}

function selectFlavorTocs(
  tocs: readonly ParsedToc[],
  flavor: TocFlavor,
): ParsedToc[] {
  const matching = tocs.filter((t) => t.flavor === flavor);
  if (matching.length > 0) return matching;
  // Fallback to the bare default TOC when no flavor-specific variant exists.
  return tocs.filter((t) => t.flavor === "default");
}
