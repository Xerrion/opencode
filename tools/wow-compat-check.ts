// tools/wow-compat-check.ts
//
// Given a Lua source file or directory, report which curated WoW APIs are
// available on each requested flavor (retail / classic / classic_era /
// classic_anniversary) and whether the call-site arg count fits the
// signature. The tool reports KNOWNS - unknown APIs are silently omitted by
// design, because false positives destroy trust in compat tools.
//
// Module dependencies:
//
//   wow-compat-check.ts -> data/api-flavors.ts
//   wow-compat-check.ts -> _shared.ts
//
// No other arrows. The dataset module is pure data; this file is pure logic
// over that data.

import { tool } from "@opencode-ai/plugin";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  renderError,
  renderNoMatch,
  renderReport,
  stripBasePath,
  TITLES,
} from "./_shared";
import {
  ALL_FLAVORS,
  API_FLAVOR_MAP,
  API_FLAVORS,
  KNOWN_GLOBAL_NAMES,
  type ApiFlavorInfo,
  type Arity,
  type Flavor,
  type FlavorPresence,
} from "./data/api-flavors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CallSite {
  readonly name: string;
  readonly argCount: number;
  readonly relPath: string;
  readonly line: number;
  readonly argText: string;
}

type ArityFit = "ok" | "too-few" | "too-many" | "unknown";

interface FlavorRow {
  readonly flavor: Flavor;
  readonly status: "present" | "absent" | "removed";
  readonly since?: string;
  readonly removed?: string;
  readonly arityFit: ArityFit;
  readonly arity?: Arity;
  /** True when this row was filled from a fallback flavor (anniversary -> era). */
  readonly fromFallback?: boolean;
}

interface MatchedCall {
  readonly call: CallSite;
  readonly info: ApiFlavorInfo;
  readonly rows: readonly FlavorRow[];
}

// ---------------------------------------------------------------------------
// Balanced-paren parsing
// ---------------------------------------------------------------------------
//
// TODO: lift `extractBalancedArgs` and `splitTopLevelArgs` into `_shared.ts`
// once a third caller appears. Currently `wow-addon-lint.ts` defines its own
// (unexported) copy and we duplicate the logic here per the ADR's guidance.

/**
 * Walk forward from `start` (the index immediately after an opening `(`) and
 * return the substring up to the matching closing `)`, respecting nested
 * brackets and double-quoted strings. Returns `null` when the parens don't
 * balance on the same line - caller treats that as a multi-line call and
 * silently skips it.
 */
function extractBalancedArgs(line: string, start: number): string | null {
  // Object-state holder per the dogfood `globals` rule pattern in
  // wow-addon-lint.ts: `let depth = ...` would trip the lint, but a member
  // assignment `s.depth = ...` does not.
  const s = { depth: 1, i: start };
  while (s.i < line.length && s.depth > 0) {
    const ch = line[s.i];
    if (ch === '"') {
      s.i++;
      while (s.i < line.length && line[s.i] !== '"') {
        if (line[s.i] === "\\") s.i++;
        s.i++;
      }
    } else if (ch === "(" || ch === "[" || ch === "{") s.depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      s.depth--;
      if (s.depth === 0) return line.slice(start, s.i);
    }
    s.i++;
  }
  return null;
}

/**
 * Count top-level comma-separated args inside a balanced argument substring.
 * Empty arg text counts as 0; nested brackets and string literals are opaque.
 */
function countTopLevelArgs(args: string): number {
  if (args.trim() === "") return 0;
  const s = {
    depth: 0,
    count: 1,
    inString: false,
    inSingle: false,
    inLongBracket: false,
  };
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (s.inLongBracket) {
      if (ch === "]" && args[i + 1] === "]") {
        s.inLongBracket = false;
        i++;
      }
      // Long brackets do not process escape sequences.
      continue;
    }
    if (s.inString) {
      if (ch === "\\" && i + 1 < args.length) {
        i++;
        continue;
      }
      if (ch === '"') s.inString = false;
      continue;
    }
    if (s.inSingle) {
      if (ch === "\\" && i + 1 < args.length) {
        i++;
        continue;
      }
      if (ch === "'") s.inSingle = false;
      continue;
    }
    if (ch === '"') {
      s.inString = true;
      continue;
    }
    if (ch === "'") {
      s.inSingle = true;
      continue;
    }
    if (ch === "[" && args[i + 1] === "[") {
      s.inLongBracket = true;
      i++;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") s.depth++;
    else if (ch === ")" || ch === "]" || ch === "}") s.depth--;
    else if (ch === "," && s.depth === 0) s.count++;
  }
  return s.count;
}

// ---------------------------------------------------------------------------
// Workspace root + path helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the workspace root: nearest ancestor of `start` containing a
 * `.git` directory, falling back to `start`'s containing directory when no
 * such ancestor exists.
 */
function resolveWorkspaceRoot(start: string): string {
  const startStat = statSync(start);
  const walkFrom = startStat.isDirectory() ? start : path.dirname(start);
  const s = { dir: walkFrom };
  while (true) {
    if (existsSync(path.join(s.dir, ".git"))) return s.dir;
    const parent = path.dirname(s.dir);
    if (parent === s.dir) return walkFrom;
    s.dir = parent;
  }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

const SKIP_DIR_NAMES = new Set([".git"]);

function isVendoredPath(absPath: string): boolean {
  // Heuristic from the ADR: any path containing `/Libs/` is a vendored
  // library authored by another addon, out of compat-check scope.
  return absPath.includes(`${path.sep}Libs${path.sep}`);
}

function walkLuaFiles(root: string, out: string[]): void {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      if (entry.name === "Libs") continue;
      walkLuaFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".lua")) continue;
    if (isVendoredPath(full)) continue;
    out.push(full);
  }
}

function discoverLuaFiles(target: string): string[] {
  const stat = statSync(target);
  if (stat.isFile()) {
    if (!target.endsWith(".lua")) return [];
    return [target];
  }
  const out: string[] = [];
  walkLuaFiles(target, out);
  out.sort();
  return out;
}

// ---------------------------------------------------------------------------
// Call-site scanner
// ---------------------------------------------------------------------------

const NAMESPACED_HEAD = /\bC_[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+\s*\(/g;

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a single regex that matches any known global as a word-boundary call.
 * Returns `null` when the dataset has zero globals (regex with empty
 * alternation is invalid).
 */
function buildGlobalsRegex(): RegExp | null {
  if (KNOWN_GLOBAL_NAMES.size === 0) return null;
  const alternation = [...KNOWN_GLOBAL_NAMES].map(escapeRegex).join("|");
  return new RegExp(`\\b(?:${alternation})\\s*\\(`, "g");
}

const GLOBALS_REGEX = buildGlobalsRegex();

function scanLine(
  line: string,
  lineNumber: number,
  relPath: string,
  out: CallSite[],
): void {
  // Strip trailing line comments cheaply: any `--` outside a string literal
  // ends the scannable region. We use a coarse heuristic - the balanced
  // extractor still rejects malformed slices with `null`.
  const commentIdx = findLineCommentStart(line);
  const scannable = commentIdx >= 0 ? line.slice(0, commentIdx) : line;

  collectFromRegex(scannable, lineNumber, relPath, NAMESPACED_HEAD, out);
  if (GLOBALS_REGEX !== null) {
    collectFromRegex(scannable, lineNumber, relPath, GLOBALS_REGEX, out);
  }
}

function findLineCommentStart(line: string): number {
  const s = { inDouble: false, inSingle: false };
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (s.inDouble) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') s.inDouble = false;
      continue;
    }
    if (s.inSingle) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "'") s.inSingle = false;
      continue;
    }
    if (ch === '"') s.inDouble = true;
    else if (ch === "'") s.inSingle = true;
    else if (ch === "-" && line[i + 1] === "-") return i;
  }
  return -1;
}

function collectFromRegex(
  line: string,
  lineNumber: number,
  relPath: string,
  pattern: RegExp,
  out: CallSite[],
): void {
  pattern.lastIndex = 0;
  const s = { match: pattern.exec(line) };
  while (s.match !== null) {
    const headEnd = s.match.index + s.match[0].length;
    const argText = extractBalancedArgs(line, headEnd);
    if (argText !== null) {
      const head = s.match[0];
      const name = head.slice(0, head.lastIndexOf("(")).trim();
      out.push({
        name,
        argCount: countTopLevelArgs(argText),
        relPath,
        line: lineNumber,
        argText: argText.trim(),
      });
    }
    s.match = pattern.exec(line);
  }
}

async function scanFile(
  absPath: string,
  workspaceRoot: string,
): Promise<CallSite[]> {
  const file = Bun.file(absPath);
  const content = await file.text();
  const relPath = stripBasePath(workspaceRoot, absPath);
  const lines = content.split("\n");
  const out: CallSite[] = [];
  for (let i = 0; i < lines.length; i++) {
    scanLine(lines[i], i + 1, relPath, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

function presenceForFlavor(
  info: ApiFlavorInfo,
  flavor: Flavor,
): { presence: FlavorPresence | undefined; fromFallback: boolean } {
  const direct = info.flavors[flavor];
  if (direct) return { presence: direct, fromFallback: false };
  if (flavor === "classic_anniversary") {
    const era = info.flavors.classic_era;
    if (era) return { presence: era, fromFallback: true };
  }
  return { presence: undefined, fromFallback: false };
}

function checkArity(arity: Arity | undefined, argCount: number): ArityFit {
  if (arity === undefined) return "unknown";
  if ("variadic" in arity) {
    return argCount < arity.minRequired ? "too-few" : "ok";
  }
  if (argCount < arity.required) return "too-few";
  if (argCount > arity.required + arity.optional) return "too-many";
  return "ok";
}

function rowsForCall(
  call: CallSite,
  info: ApiFlavorInfo,
  requested: readonly Flavor[],
): FlavorRow[] {
  return requested.map((flavor) => {
    const { presence, fromFallback } = presenceForFlavor(info, flavor);
    if (presence === undefined) {
      return { flavor, status: "absent", arityFit: "unknown" };
    }
    if (presence.removed !== undefined) {
      return {
        flavor,
        status: "removed",
        removed: presence.removed,
        arityFit: "unknown",
        fromFallback,
      };
    }
    return {
      flavor,
      status: "present",
      since: presence.since,
      arityFit: checkArity(presence.arity, call.argCount),
      arity: presence.arity,
      fromFallback,
    };
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function formatArity(arity: Arity): string {
  if ("variadic" in arity) return `${arity.minRequired}+`;
  if (arity.optional === 0) return `${arity.required}`;
  return `${arity.required}-${arity.required + arity.optional}`;
}

function renderArityTail(call: CallSite, row: FlavorRow): string {
  if (row.arityFit === "ok" || row.arityFit === "unknown") return "";
  if (row.arity === undefined) return "";
  return ` (args: ${call.argCount}, signature expects ${formatArity(row.arity)})`;
}

function renderRow(call: CallSite, row: FlavorRow): string {
  const fallbackTag = row.fromFallback ? " *(fallback: classic_era)*" : "";
  if (row.status === "absent") {
    return `  - ${row.flavor}: ✗ not available${fallbackTag}`;
  }
  if (row.status === "removed") {
    return `  - ${row.flavor}: ✗ removed in ${row.removed}${fallbackTag}`;
  }
  // present
  const since = row.since ? ` since ${row.since}` : "";
  if (row.arityFit === "too-few" || row.arityFit === "too-many") {
    return `  - ${row.flavor}: ⚠ signature mismatch${since}${renderArityTail(call, row)}${fallbackTag}`;
  }
  return `  - ${row.flavor}: ✓${since}${fallbackTag}`;
}

function renderCallBlock(matched: MatchedCall): string {
  const { call, rows } = matched;
  const sigLine = `\`${call.name}(${call.argText})\` (args: ${call.argCount})`;
  const rowLines = rows.map((r) => renderRow(call, r)).join("\n");
  return `- **Line ${call.line}** — ${sigLine}\n${rowLines}`;
}

function renderResultBody(
  byFile: ReadonlyMap<string, readonly MatchedCall[]>,
  totalFiles: number,
  totalCalls: number,
): string {
  const fileCount = byFile.size;
  const summary =
    `Scanned ${totalFiles} file(s); matched ${totalCalls} call site(s) ` +
    `in ${fileCount} file(s) against the curated compatibility dataset.`;

  const sections: string[] = [summary];
  const sortedFiles = [...byFile.keys()].sort();
  for (const relPath of sortedFiles) {
    const calls = byFile.get(relPath);
    if (!calls || calls.length === 0) continue;
    const blocks = calls.map(renderCallBlock).join("\n\n");
    sections.push(`### ${relPath}\n\n${blocks}`);
  }
  return sections.join("\n\n");
}

function buildNotes(matched: readonly MatchedCall[]): string {
  const datasetSize = API_FLAVORS.length;
  const lines: string[] = [
    `Compat data covers ${datasetSize} API${datasetSize === 1 ? "" : "s"}. The tool reports knowns and silently omits call sites with no entry - a missing row is not a warning.`,
    "`classic_anniversary` falls back to `classic_era` data when no anniversary-specific entry exists; rows filled this way are tagged inline.",
  ];
  const seen = new Set<string>();
  for (const m of matched) {
    if (m.info.notes && !seen.has(m.info.name)) {
      seen.add(m.info.name);
      lines.push(`- \`${m.info.name}\`: ${m.info.notes}`);
    }
  }
  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const VALID_FLAVORS: ReadonlySet<string> = new Set(ALL_FLAVORS);

function parseFlavors(input: readonly string[] | undefined): readonly Flavor[] {
  if (input === undefined || input.length === 0) return ALL_FLAVORS;
  const out: Flavor[] = [];
  for (const f of input) {
    if (!VALID_FLAVORS.has(f)) {
      throw new Error(
        `Unknown flavor: ${f}. Valid: ${ALL_FLAVORS.join(", ")}.`,
      );
    }
    out.push(f as Flavor);
  }
  return out;
}

async function runCompatCheck(
  target: string,
  flavors: readonly Flavor[],
): Promise<string> {
  const metadata: Array<readonly [string, string]> = [
    ["Target", `\`${target}\``],
    ["Flavors", flavors.join(", ")],
  ];

  // Boundary check: target must exist.
  if (!existsSync(target)) {
    return renderError({
      title: TITLES.compatCheck,
      metadata,
      reason: "Target not found.",
      cause: `No file or directory at ${target}.`,
      suggestions: [
        "Pass an absolute path or a path relative to the current working directory.",
        "Verify the file extension is `.lua` for single-file mode.",
      ],
    });
  }

  // Boundary check: dataset must be non-empty.
  if (API_FLAVORS.length === 0) {
    return renderError({
      title: TITLES.compatCheck,
      metadata,
      reason: "Compatibility dataset is empty.",
      cause: "tools/data/api-flavors.ts exported zero entries.",
      suggestions: [
        "Re-seed the dataset from version control.",
        "Verify `API_FLAVORS` in `tools/data/api-flavors.ts` is populated.",
      ],
    });
  }

  const absTarget = path.resolve(target);
  const workspaceRoot = resolveWorkspaceRoot(absTarget);
  const files = discoverLuaFiles(absTarget);

  if (files.length === 0) {
    return renderNoMatch({
      title: TITLES.compatCheck,
      metadata,
      paragraph: `No \`.lua\` files found under ${stripBasePath(workspaceRoot, absTarget)}.`,
      suggestions: [
        "Pass a `.lua` file directly to scan a single file.",
        "Verify the directory contains addon source (vendored `Libs/` is skipped).",
      ],
    });
  }

  const allCalls: CallSite[] = [];
  for (const abs of files) {
    const calls = await scanFile(abs, workspaceRoot);
    allCalls.push(...calls);
  }

  const matched: MatchedCall[] = [];
  for (const call of allCalls) {
    const info = API_FLAVOR_MAP.get(call.name);
    if (!info) continue;
    matched.push({ call, info, rows: rowsForCall(call, info, flavors) });
  }

  if (matched.length === 0) {
    return renderNoMatch({
      title: TITLES.compatCheck,
      metadata: [...metadata, ["Files Scanned", String(files.length)]],
      paragraph: `Scanned ${files.length} file(s); no API calls in the curated compatibility dataset were referenced.`,
      suggestions: [
        "Run `wow-api-lookup` to inspect any specific symbol.",
        "Expand the dataset in `tools/data/api-flavors.ts` to cover additional APIs.",
        "Confirm the target path includes the addon source you expect to scan.",
      ],
      notes: `Compat data covers ${API_FLAVORS.length} API${API_FLAVORS.length === 1 ? "" : "s"}.`,
    });
  }

  const byFile = new Map<string, MatchedCall[]>();
  for (const m of matched) {
    const list = byFile.get(m.call.relPath);
    if (list) list.push(m);
    else byFile.set(m.call.relPath, [m]);
  }

  return renderReport({
    title: TITLES.compatCheck,
    metadata: [
      ...metadata,
      ["Files Scanned", String(files.length)],
      ["Calls Matched", String(matched.length)],
    ],
    body: {
      outcome: "result",
      body: renderResultBody(byFile, files.length, matched.length),
    },
    notes: buildNotes(matched),
  });
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export default tool({
  description:
    "Report per-flavor (retail / classic / classic_era / classic_anniversary) availability and arity-fit for the WoW APIs an addon source calls. Scans a `.lua` file or a directory of `.lua` files, matches each call site against a curated dataset (`tools/data/api-flavors.ts`), and renders one row per requested flavor per known call.\n\n" +
    "The tool reports KNOWNS. Call sites whose API is not in the dataset are silently omitted - this is a deliberate non-goal: false positives destroy trust in compat tools. Missing rows are not warnings.\n\n" +
    "Argument-level signature checking is arity-only (required / optional / variadic counts). Type-level drift is out of scope. `classic_anniversary` falls back to `classic_era` data when no anniversary-specific entry exists; fallback rows are tagged inline.",
  args: {
    target: tool.schema
      .string()
      .min(1)
      .describe(
        "Absolute or workspace-relative path to a `.lua` file or a directory. Directory mode walks for `*.lua`, skipping `.git/` and any path containing `/Libs/` (vendored libraries).",
      ),
    flavors: tool.schema
      .array(
        tool.schema.enum([
          "retail",
          "classic",
          "classic_era",
          "classic_anniversary",
        ]),
      )
      .optional()
      .describe(
        "Flavors to check against. Defaults to all four (`retail`, `classic`, `classic_era`, `classic_anniversary`).",
      ),
  },
  async execute(args) {
    try {
      const flavors = parseFlavors(args.flavors);
      return await runCompatCheck(args.target, flavors);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return renderError({
        title: TITLES.compatCheck,
        metadata: [["Target", `\`${args.target}\``]],
        reason: "Compatibility check failed.",
        cause: message,
        suggestions: [
          "Verify the target path exists and is readable.",
          "Re-run with a `.lua` file or a directory containing `.lua` source.",
        ],
      });
    }
  },
});
