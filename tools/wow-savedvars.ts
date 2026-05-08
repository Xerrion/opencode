// tools/wow-savedvars.ts
//
// Read-only introspection tool for WoW addon `SavedVariables` `.lua` files.
// See ADR `.deliverables/tech-lead/wave3-feature10-savedvariables-introspection.md`.
//
// Modes:
//   - `summary` (default): tabulate top-level globals (type, children, depth, approx bytes)
//   - `tree`:              indented tree to `maxDepth` (default 3)
//   - `value`:             requires `path`; renders the subtree at that path
//
// Optional `--toc <path>`: when provided, parse the TOC's SavedVariables
// declarations and surface mismatches against the file's top-level globals
// in `## Notes`.

import { tool } from "@opencode-ai/plugin";
import os from "node:os";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import {
  renderError,
  renderNoMatch,
  renderReport,
  stripBasePath,
  TITLES,
  type MetadataPair,
} from "./_shared";
import type { SVDocument } from "./savedvars/ast";
import { ParseError, tokenize } from "./savedvars/tokenizer";
import { parseDocument } from "./savedvars/parser";
import {
  formatPath,
  lexPath,
  PathSyntaxError,
  resolvePath,
  type PathSegment,
} from "./savedvars/path";
import { computeStats, statsFor } from "./savedvars/stats";
import { formatBytes, renderSummary, renderTree, renderValue } from "./savedvars/render";
import { detectAnomalies } from "./savedvars/anomalies";
import { parseTocSavedVariables } from "./savedvars/toc";

const DEFAULT_TREE_DEPTH = 3;
const DEFAULT_VALUE_DEPTH = 20;

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
// File resolution
// ---------------------------------------------------------------------------

type FileResolution =
  | { ok: true; absolute: string; display: string; size: number }
  | { ok: false; reason: string };

function resolveFile(target: string): FileResolution {
  const trimmed = target.trim();
  if (!trimmed) return { ok: false, reason: "Empty `file` argument." };
  const expanded = expandHome(trimmed);
  const absolute = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(process.cwd(), expanded);
  if (!existsSync(absolute)) {
    return { ok: false, reason: `File does not exist: ${trimmed}` };
  }
  const stat = statSync(absolute);
  if (!stat.isFile()) {
    return { ok: false, reason: `Target is not a regular file: ${trimmed}` };
  }
  if (!absolute.endsWith(".lua")) {
    return { ok: false, reason: "Target must be a `.lua` file." };
  }
  return {
    ok: true,
    absolute,
    display: stripBasePath(process.cwd(), absolute),
    size: stat.size,
  };
}

// ---------------------------------------------------------------------------
// TOC cross-check
// ---------------------------------------------------------------------------

interface TocCrossCheck {
  readonly displayPath: string;
  readonly declaredNotFound: string[];
  readonly foundNotDeclared: string[];
}

async function loadTocCrossCheck(
  tocArg: string,
  doc: SVDocument,
): Promise<TocCrossCheck | { error: string }> {
  const expanded = expandHome(tocArg.trim());
  const absolute = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(process.cwd(), expanded);
  if (!existsSync(absolute)) {
    return { error: `TOC file does not exist: ${tocArg}` };
  }
  const stat = statSync(absolute);
  if (!stat.isFile()) {
    return { error: `TOC target is not a regular file: ${tocArg}` };
  }
  const content = await Bun.file(absolute).text();
  const declared = parseTocSavedVariables(content);
  const all = new Set<string>([...declared.account, ...declared.perCharacter]);
  const found = new Set(doc.keys());

  const declaredNotFound = [...all].filter((n) => !found.has(n)).sort();
  const foundNotDeclared = [...found].filter((n) => !all.has(n)).sort();

  return {
    displayPath: stripBasePath(process.cwd(), absolute),
    declaredNotFound,
    foundNotDeclared,
  };
}

function renderTocNotes(check: TocCrossCheck): string | undefined {
  if (check.declaredNotFound.length === 0 && check.foundNotDeclared.length === 0) {
    return `**TOC cross-check** (\`${check.displayPath}\`): all declarations matched.`;
  }
  const lines = [`**TOC cross-check** (\`${check.displayPath}\`)`];
  if (check.declaredNotFound.length > 0) {
    lines.push(
      `- Declared but not found in file: ${check.declaredNotFound.map((n) => `\`${n}\``).join(", ")}`,
    );
  }
  if (check.foundNotDeclared.length > 0) {
    lines.push(
      `- Found in file but not declared: ${check.foundNotDeclared.map((n) => `\`${n}\``).join(", ")}`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Mode dispatch
// ---------------------------------------------------------------------------

type Mode = "summary" | "tree" | "value";

function selectMode(rawMode: Mode | undefined, hasPath: boolean): Mode {
  if (rawMode) return rawMode;
  if (hasPath) return "value";
  return "summary";
}

function buildBaseMetadata(
  display: string,
  size: number,
  globalCount: number,
  mode: Mode,
): MetadataPair[] {
  return [
    ["File", display],
    ["Size", formatBytes(size)],
    ["Globals", String(globalCount)],
    ["Mode", mode],
  ];
}

function combineNotes(parts: ReadonlyArray<string | undefined>): string | undefined {
  const filtered = parts.filter((p): p is string => p !== undefined && p.trim() !== "");
  if (filtered.length === 0) return undefined;
  return filtered.join("\n\n");
}

// ---------------------------------------------------------------------------
// Tool export
// ---------------------------------------------------------------------------

export default tool({
  description:
    "Read-only inspector for WoW addon `SavedVariables` `.lua` files.\n\n" +
    "Parses the constrained Lua subset emitted by the WoW client serializer (top-level `IDENT = VALUE` statements with literal scalars and nested table constructors) into a typed AST and renders one of three views.\n\n" +
    "Modes:\n" +
    "- `summary` (default): tabulates top-level globals with type, child count, depth, and approximate source-form bytes.\n" +
    "- `tree`: indented Lua-like tree, capped at `maxDepth` (default 3) with truncation markers (`...(N more)` / `...(N keys)`).\n" +
    "- `value`: drill-down into a sub-value via `path` (dot + bracket notation, e.g. `MyDB.profiles[\"Default\"].bar` or `MyDB.list[1]`).\n\n" +
    "Anomalies (largest subtrees > 10% of file, depths > 8, arrays > 1000 entries) are surfaced in `## Notes`.\n\n" +
    "Optional `toc`: pass a `.toc` path to cross-check `## SavedVariables:` and `## SavedVariablesPerCharacter:` declarations against the file's top-level globals; mismatches are reported in `## Notes`.\n\n" +
    "Non-goals: does NOT execute Lua, does NOT support function calls / operators / locals / metatables / long-bracket strings, does NOT modify the file, does NOT roundtrip-write.",
  args: {
    file: tool.schema
      .string()
      .describe(
        "Path to a SavedVariables `.lua` file. Absolute, `~`-prefixed, or relative to CWD.",
      ),
    mode: tool.schema
      .enum(["summary", "tree", "value"])
      .optional()
      .describe(
        "`summary` (default): top-level globals only. `tree`: indented tree to `maxDepth`. `value`: requires `path`, renders the subtree at that path. If `path` is supplied without `mode`, defaults to `value`.",
      ),
    path: tool.schema
      .string()
      .optional()
      .describe(
        'Drill-down path, e.g. `MyAddonDB.profiles["Default"].bar` or `MyDB.list[1].name`. Required when `mode = "value"`; ignored otherwise.',
      ),
    maxDepth: tool.schema
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe(
        "Tree-render depth cap. Default 3 for `tree`, 20 (effectively unbounded) for `value`.",
      ),
    toc: tool.schema
      .string()
      .optional()
      .describe(
        "Optional path to a `.toc` file. When provided, the tool parses `## SavedVariables:` and `## SavedVariablesPerCharacter:` directives and surfaces mismatches against the file's top-level globals in `## Notes`.",
      ),
  },
  async execute(args) {
    const { file, path: pathArg, toc, maxDepth } = args;
    const mode = selectMode(args.mode, pathArg !== undefined);

    const resolution = resolveFile(file);
    if (!resolution.ok) {
      return renderError({
        title: TITLES.savedVars,
        metadata: [["File", file]],
        reason: "Could not open SavedVariables file.",
        cause: resolution.reason,
        suggestions: [
          "Verify the path exists and points to a `.lua` file.",
          "Pass an absolute path, a `~`-prefixed path, or a path relative to CWD.",
        ],
      });
    }

    if (mode === "value" && pathArg === undefined) {
      return renderError({
        title: TITLES.savedVars,
        metadata: [
          ["File", resolution.display],
          ["Mode", "value"],
        ],
        reason: "`value` mode requires a `path`.",
        cause: "(no `path` argument provided)",
        suggestions: [
          'Pass `path` such as `MyAddonDB.profiles["Default"].bar`.',
          "Or use `mode: \"summary\"` / `mode: \"tree\"` for whole-file views.",
        ],
      });
    }

    const source = await Bun.file(resolution.absolute).text();
    let doc: SVDocument;
    try {
      doc = parseDocument(tokenize(source));
    } catch (err) {
      const baseMeta: MetadataPair[] = [
        ["File", resolution.display],
        ["Size", formatBytes(resolution.size)],
        ["Mode", mode],
      ];
      if (err instanceof ParseError) {
        return renderError({
          title: TITLES.savedVars,
          metadata: baseMeta,
          reason: "Failed to parse SavedVariables file.",
          cause: err.message,
          suggestions: [
            "This tool only handles client-serialized output, not hand-edited Lua.",
            "Verify the file is the raw `WTF/Account/.../SavedVariables/<Addon>.lua` produced by the game client.",
          ],
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      return renderError({
        title: TITLES.savedVars,
        metadata: baseMeta,
        reason: "Failed to parse SavedVariables file.",
        cause: message,
        suggestions: [
          "Verify the file is readable.",
          "Verify the file is the raw client-serialized SavedVariables, not a derivative.",
        ],
      });
    }

    const stats = computeStats(doc);
    const baseMeta = buildBaseMetadata(resolution.display, resolution.size, doc.size, mode);

    // TOC cross-check (any mode).
    let tocNote: string | undefined;
    if (toc !== undefined) {
      const result = await loadTocCrossCheck(toc, doc);
      if ("error" in result) {
        return renderError({
          title: TITLES.savedVars,
          metadata: baseMeta,
          reason: "Could not open TOC file for cross-check.",
          cause: result.error,
          suggestions: [
            "Verify the `.toc` path exists and is readable.",
            "Omit the `toc` argument to skip the cross-check.",
          ],
        });
      }
      tocNote = renderTocNotes(result);
    }

    if (mode === "summary") {
      return renderReport({
        title: TITLES.savedVars,
        metadata: baseMeta,
        body: { outcome: "result", body: renderSummary(doc, stats) },
        notes: combineNotes([detectAnomalies(doc, stats, resolution.size), tocNote]),
      });
    }

    if (mode === "tree") {
      const depth = maxDepth ?? DEFAULT_TREE_DEPTH;
      const meta: MetadataPair[] = [...baseMeta, ["Max Depth", String(depth)]];
      return renderReport({
        title: TITLES.savedVars,
        metadata: meta,
        body: { outcome: "result", body: renderTree(doc, stats, depth) },
        notes: combineNotes([detectAnomalies(doc, stats, resolution.size), tocNote]),
      });
    }

    // mode === "value"
    return runValueMode({
      doc,
      stats,
      pathArg: pathArg!,
      maxDepth: maxDepth ?? DEFAULT_VALUE_DEPTH,
      baseMeta,
      fileBytes: resolution.size,
      tocNote,
    });
  },
});

// ---------------------------------------------------------------------------
// Value-mode handler (extracted so the main `execute` stays under 100 LOC)
// ---------------------------------------------------------------------------

interface ValueModeArgs {
  readonly doc: SVDocument;
  readonly stats: ReturnType<typeof computeStats>;
  readonly pathArg: string;
  readonly maxDepth: number;
  readonly baseMeta: ReadonlyArray<MetadataPair>;
  readonly fileBytes: number;
  readonly tocNote: string | undefined;
}

function runValueMode(v: ValueModeArgs): string {
  let segments: PathSegment[];
  try {
    segments = lexPath(v.pathArg);
  } catch (err) {
    if (err instanceof PathSyntaxError) {
      return renderError({
        title: TITLES.savedVars,
        metadata: [...v.baseMeta, ["Path", v.pathArg]],
        reason: "Invalid drill-down path syntax.",
        cause: err.message,
        suggestions: [
          'Use dot notation for identifier keys: `MyDB.profiles.Default`.',
          'Use bracket notation for non-identifier keys: `MyDB.profiles["en-US"]` or `MyDB.list[1]`.',
        ],
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    return renderError({
      title: TITLES.savedVars,
      metadata: [...v.baseMeta, ["Path", v.pathArg]],
      reason: "Invalid drill-down path syntax.",
      cause: message,
      suggestions: ["Verify the path uses dot + bracket notation."],
    });
  }

  const pathLabel = formatPath(segments);
  const meta: MetadataPair[] = [
    ...v.baseMeta,
    ["Path", pathLabel],
    ["Max Depth", String(v.maxDepth)],
  ];

  const result = resolvePath(v.doc, segments);
  if (!result.ok) {
    const failingSeg = segments[result.at];
    const segLabel =
      failingSeg.kind === "string"
        ? `\`${failingSeg.value}\``
        : `\`[${failingSeg.value}]\``;
    const reasonText =
      result.reason === "scalar-traversal"
        ? `cannot traverse into a scalar at segment ${result.at + 1} (${segLabel}); the parent value is not a table`
        : `no such key at segment ${result.at + 1} (${segLabel})`;
    return renderNoMatch({
      title: TITLES.savedVars,
      metadata: meta,
      paragraph: `Path \`${pathLabel}\` did not resolve: ${reasonText}.`,
      suggestions: [
        "Run `mode: \"summary\"` to list top-level globals.",
        "Run `mode: \"tree\"` with a small `maxDepth` to discover the actual key names.",
        "Verify quoting and bracket notation for non-identifier keys.",
      ],
      notes: v.tocNote,
    });
  }

  const body = renderValue(result.value, v.stats, pathLabel, v.maxDepth);
  // Anomaly walk is whole-document (relative to file size); only include when
  // the resolved value is a table large enough to be interesting.
  const anomalyNote =
    result.value.kind === "table" &&
    statsFor(result.value, v.stats).approxBytes > v.fileBytes * 0.1
      ? detectAnomalies(v.doc, v.stats, v.fileBytes)
      : undefined;

  return renderReport({
    title: TITLES.savedVars,
    metadata: meta,
    body: { outcome: "result", body },
    notes: combineNotes([anomalyNote, v.tocNote]),
  });
}
