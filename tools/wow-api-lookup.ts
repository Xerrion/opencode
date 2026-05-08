import { tool } from "@opencode-ai/plugin";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  formatRgLines,
  renderError,
  renderNoMatch,
  renderReport,
  runRg,
  stripBasePath,
  TITLES,
  WOW_ANNOTATIONS_ROOT,
} from "./_shared";
import {
  LIBRARY_SNIPPETS,
  type LibrarySnippet,
} from "./data/library-snippets";
import { resolveFrameXMLBase } from "./wow-blizzard-source";

const ANNOTATIONS_ROOT = WOW_ANNOTATIONS_ROOT;

const CATEGORY_PATHS: Record<string, string> = {
  api: "Core/Blizzard_APIDocumentationGenerated",
  widget: "Core/Widget",
  type: "Core/Type",
  data: "Core/Data",
  library: "Core/Libraries",
  lua: "Core/Lua",
  framexml: "FrameXML",
  all: "",
};

const VALID_CATEGORIES = Object.keys(CATEGORY_PATHS);

function resolveSearchPath(category: string): string {
  const subpath = CATEGORY_PATHS[category];
  if (subpath === undefined) {
    throw new Error(
      `Invalid category "${category}". Valid: ${VALID_CATEGORIES.join(", ")}`,
    );
  }
  return subpath ? path.join(ANNOTATIONS_ROOT, subpath) : ANNOTATIONS_ROOT;
}

function formatRgOutput(raw: string): string {
  return formatRgLines(ANNOTATIONS_ROOT, raw);
}

function simplifyQuery(query: string): string {
  // Strip common prefixes to find a filename-friendly search term
  // "C_LootHistory" -> "LootHistory", "Enum.ItemQuality" -> "ItemQuality"
  return query
    .replace(/^C_/, "")
    .replace(/^Enum\./, "")
    .replace(/^Mixin\./, "")
    .replaceAll(".", "");
}

async function searchWithContext(
  query: string,
  searchPath: string,
  caseSensitive: boolean,
  context: number,
  maxCount: number,
): Promise<string> {
  const args = [
    ...(caseSensitive ? [] : ["-i"]),
    "--no-heading",
    "--with-filename",
    "-n",
    "--context",
    String(context),
    "--max-count",
    String(maxCount),
    "--glob",
    "*.lua",
    query,
    searchPath,
  ];
  return await runRg(args);
}

async function findMatchingFiles(
  simplified: string,
  searchPath: string,
): Promise<string[]> {
  const raw = await runRg([
    "--files",
    "--glob",
    `*${simplified}*.lua`,
    searchPath,
  ]);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean);
}

async function readFileHead(
  filePath: string,
  maxLines: number,
): Promise<{ relPath: string; body: string }> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split("\n");
  const truncated = lines.length > maxLines;
  const content = lines.slice(0, maxLines).join("\n");
  const relPath = stripBasePath(ANNOTATIONS_ROOT, filePath);
  const footer = truncated
    ? `\n... truncated at ${maxLines} of ${lines.length} lines`
    : "";
  return { relPath, body: `${content}${footer}` };
}

function buildApiMetadata(
  query: string,
  category: string,
  match: string,
): readonly [string, string][] {
  return [
    ["Query", `\`${query}\``],
    ["Category", category],
    ["Match", match],
  ];
}

// ---------------------------------------------------------------------------
// "Used by Blizzard in" pivot
//
// Best-effort cross-tool lookup: when api-lookup finds a hit, run a bounded
// ripgrep against the FrameXML source tree to surface up to 3 example call
// sites. Silent fallback: any failure (no FrameXML installed, rg error,
// regex syntax in query) returns [] and the api-lookup output is unchanged.
// ---------------------------------------------------------------------------

const PIVOT_SKIP_CATEGORIES = new Set(["lua", "data", "library"]);
const PIVOT_MIN_QUERY_LENGTH = 4;
const PIVOT_MAX_RESULTS = 3;

function shouldRunPivot(query: string, category: string): boolean {
  if (PIVOT_SKIP_CATEGORIES.has(category)) return false;
  if (query.trim().length < PIVOT_MIN_QUERY_LENGTH) return false;
  return true;
}

function extractPivotSymbol(query: string): string {
  const lastDot = query.lastIndexOf(".");
  return lastDot === -1 ? query : query.slice(lastDot + 1);
}

async function findBlizzardUsages(
  query: string,
  category: string,
): Promise<string[]> {
  if (!shouldRunPivot(query, category)) return [];

  const symbol = extractPivotSymbol(query);
  if (symbol.length < PIVOT_MIN_QUERY_LENGTH) return [];

  try {
    const framexmlBase = resolveFrameXMLBase(undefined);
    if (!existsSync(framexmlBase)) return [];

    // -F treats the symbol as a fixed literal (no regex interpretation),
    // which is what we want for a function/identifier name and which sidesteps
    // regex syntax errors when the symbol contains '.', '[', etc.
    // --max-count 1 caps matches per file; .slice() caps the total.
    const raw = await runRg([
      "-F",
      "--no-heading",
      "--with-filename",
      "-n",
      "--max-count",
      "1",
      "--glob",
      "*.lua",
      "--glob",
      "*.xml",
      symbol,
      framexmlBase,
    ]);
    if (!raw) return [];

    return raw
      .split("\n")
      .slice(0, PIVOT_MAX_RESULTS)
      .map((line) => {
        // Format: <abs-path>:<line>:<content>
        // We want <relative-path>:<line> only.
        const firstColon = line.indexOf(":");
        if (firstColon === -1) return line;
        const secondColon = line.indexOf(":", firstColon + 1);
        const filePart = line.slice(0, firstColon);
        const linePart =
          secondColon === -1
            ? line.slice(firstColon + 1)
            : line.slice(firstColon + 1, secondColon);
        return `${stripBasePath(framexmlBase, filePart)}:${linePart}`;
      });
  } catch {
    return [];
  }
}

function appendPivotFooter(body: string, usages: readonly string[]): string {
  if (usages.length === 0) return body;
  const list = usages.map((u) => `- \`${u}\``).join("\n");
  return `${body}\n\n### Used by Blizzard in\n\n${list}`;
}

// ---------------------------------------------------------------------------
// "Idiomatic Usage" curated-snippet footer
//
// For `category: "library"` symbol-mode hits, identify the library from the
// first rg match's filename and attach a hand-authored usage snippet from the
// curated dataset. Silent no-op when the snippet record has no matching entry.
// ---------------------------------------------------------------------------

function findLibrarySnippet(rgOutput: string): LibrarySnippet | null {
  // formatRgOutput emits per-line `<path><sep><line><sep><text>` where sep is
  // `:` for match lines and `-` for context lines. Both start with a `.lua`
  // path; pull the basename of the first such path we see.
  const firstLuaLine = rgOutput
    .split("\n")
    .find((line) => line.includes(".lua"));
  if (!firstLuaLine) return null;

  const luaIdx = firstLuaLine.indexOf(".lua");
  const pathPart = firstLuaLine.slice(0, luaIdx);
  const stem = path.basename(pathPart);
  if (!stem) return null;

  const direct = LIBRARY_SNIPPETS[stem];
  if (direct) return direct;

  const stemLower = stem.toLowerCase();
  for (const [key, snippet] of Object.entries(LIBRARY_SNIPPETS)) {
    if (key.toLowerCase() === stemLower) return snippet;
  }
  return null;
}

function appendSnippetFooter(
  body: string,
  snippet: LibrarySnippet | null,
): string {
  if (!snippet) return body;
  const sections = [
    "### Idiomatic Usage",
    "> Curated example. Not extracted from annotations.",
    snippet.description,
    "```lua\n" + snippet.example + "\n```",
    `**Registration:** \`${snippet.registration}\``,
    `**Docs:** ${snippet.docsUrl}`,
  ];
  if (snippet.notes) sections.push(`**Notes:** ${snippet.notes}`);
  return `${body}\n\n${sections.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// Keyword (reverse-lookup) mode
// ---------------------------------------------------------------------------

type HitKind = "return" | "param" | "field" | "prose";

interface KeywordHit {
  readonly symbol: string;
  readonly description: string;
  readonly score: number;
}

const RG_PARSE = /^(?<file>.+?\.lua)(?<sep>[:-])(?<line>\d+)\k<sep>(?<text>.*)$/;
const FUNCTION_DECL = /^function\s+([\w.:]+)\s*\(/;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(raw: string): string {
  return raw.replace(REGEX_SPECIALS, "\\$&");
}

function classifyHit(commentText: string): { kind: HitKind; score: number } {
  if (/^---@return\b/.test(commentText)) return { kind: "return", score: 3 };
  if (/^---@param\b/.test(commentText)) return { kind: "param", score: 2 };
  if (/^---@(field|class|alias)\b/.test(commentText)) {
    return { kind: "field", score: 1 };
  }
  return { kind: "prose", score: 1 };
}

function extractDescription(commentText: string, kind: HitKind): string {
  // Strip leading `---` and surrounding whitespace.
  const stripped = commentText.replace(/^---\s?/, "").trim();
  if (kind === "return") {
    // `@return type name description` or `@return type description`
    return stripped.replace(/^@return\s+\S+\s*/, "").trim();
  }
  if (kind === "param") {
    // `@param name type description`
    return stripped.replace(/^@param\s+\S+\s+\S+\s*/, "").trim();
  }
  if (kind === "field") {
    return stripped.replace(/^@(field|class|alias)\s+\S+\s*\S*\s*/, "").trim();
  }
  return stripped;
}

function buildWikiUrl(symbol: string): string | null {
  // Wiki uses `API_<symbol>` for global and `C_*` namespaced functions, with
  // `.` between namespace and method. We only emit URLs for `Word`, `Word.Word`,
  // and `Word_Word.Word` style symbols — anything with `:` (method-call) is
  // skipped because the wiki page format differs.
  if (!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)?$/.test(symbol)) return null;
  return `https://warcraft.wiki.gg/wiki/API_${symbol}`;
}

function shortDescription(raw: string, fallback: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const text = cleaned.length === 0 ? fallback : cleaned;
  const escaped = text.replace(/\|/g, "\\|");
  return escaped.length > 100 ? `${escaped.slice(0, 97)}...` : escaped;
}

interface RawMatch {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

interface ParsedBlock {
  readonly matches: readonly RawMatch[];
  readonly functionSymbol: string | null;
}

function parseBlocks(rgOutput: string): ParsedBlock[] {
  if (!rgOutput) return [];
  const blocks: ParsedBlock[] = [];
  for (const rawBlock of rgOutput.split(/\n--\n/)) {
    const matches: RawMatch[] = [];
    let functionSymbol: string | null = null;
    for (const line of rawBlock.split("\n")) {
      const parsed = RG_PARSE.exec(line);
      if (!parsed?.groups) continue;
      const { file, sep, line: lineStr, text } = parsed.groups;
      if (sep === ":") {
        // Skip noise: ---[Documentation] URL lines and ---@meta directives.
        if (/^---\[Documentation\]/.test(text)) continue;
        if (/^---@meta\b/.test(text)) continue;
        matches.push({ file, line: Number(lineStr), text });
        continue;
      }
      // Context line — look for the function declaration that owns this block.
      if (functionSymbol === null) {
        const fnMatch = FUNCTION_DECL.exec(text);
        if (fnMatch) functionSymbol = fnMatch[1];
      }
    }
    if (matches.length === 0 || functionSymbol === null) continue;
    blocks.push({ matches, functionSymbol });
  }
  return blocks;
}

function aggregateHits(
  blocks: readonly ParsedBlock[],
  query: string,
): KeywordHit[] {
  const queryToken = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  const bySymbol = new Map<string, KeywordHit>();

  for (const block of blocks) {
    const symbol = block.functionSymbol;
    if (symbol === null) continue;

    let blockScore = 0;
    let bestMatch: RawMatch | null = null;
    let bestKind: HitKind = "prose";
    let bestScore = -1;

    for (const m of block.matches) {
      const { kind, score } = classifyHit(m.text);
      blockScore += score;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = m;
        bestKind = kind;
      }
    }

    if (bestMatch === null) continue;

    // Multi-hit emphasis: +1 per additional match in the same function.
    const multiBonus = Math.max(0, block.matches.length - 1);
    // Function-name affinity: keyword token substring of fn name (case-insensitive).
    const fnNameLower = symbol.toLowerCase();
    const nameBonus =
      queryToken.length >= 3 && fnNameLower.includes(queryToken) ? 2 : 0;

    const totalScore = blockScore + multiBonus + nameBonus;
    const description = shortDescription(
      extractDescription(bestMatch.text, bestKind),
      symbol,
    );

    const existing = bySymbol.get(symbol);
    if (existing && existing.score >= totalScore) continue;

    bySymbol.set(symbol, {
      symbol,
      description,
      score: totalScore,
    });
  }

  return [...bySymbol.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.symbol.localeCompare(b.symbol);
  });
}

function renderKeywordTable(hits: readonly KeywordHit[]): string {
  const header = "| API | Description | Wiki |\n|---|---|---|";
  const rows = hits.map((h) => {
    const url = buildWikiUrl(h.symbol);
    const wikiCell = url ?? "—";
    return `| \`${h.symbol}\` | ${h.description} | ${wikiCell} |`;
  });
  return [header, ...rows].join("\n");
}

const KEYWORD_RESULT_LIMIT = 20;

async function keywordSearch(
  query: string,
  category: string,
): Promise<string> {
  const searchPath = resolveSearchPath(category);
  const escaped = escapeRegex(query);
  // Match any LuaLS comment line (`---...`) that contains the keyword. Noise
  // lines (`---[Documentation]`, `---@meta`) are filtered post-parse so we can
  // keep the regex simple and avoid PCRE2 lookarounds.
  const pattern = `^---.*${escaped}`;

  const raw = await runRg([
    "-i",
    "--no-heading",
    "--with-filename",
    "-n",
    "-A",
    "5",
    "--glob",
    "*.lua",
    pattern,
    searchPath,
  ]);

  const blocks = parseBlocks(raw);
  const hits = aggregateHits(blocks, query);

  if (hits.length === 0) {
    return renderNoMatch({
      title: TITLES.apiLookup,
      metadata: buildKeywordMetadata(query, category, "none"),
      paragraph: `No annotation comments matched the keyword \`${query}\` in category \`${category}\`.`,
      suggestions: [
        `Try a broader category (e.g. \`all\` instead of \`${category}\`)`,
        `Use a single descriptive word (e.g. \`combat\` instead of \`is in combat\`)`,
        `Try a synonym (e.g. \`reward\` instead of \`prize\`)`,
        `For exact API names, use \`mode: "symbol"\` (the default)`,
      ],
    });
  }

  const limited = hits.slice(0, KEYWORD_RESULT_LIMIT);
  const table = renderKeywordTable(limited);
  const truncatedNote =
    hits.length > KEYWORD_RESULT_LIMIT
      ? `- Showing top ${KEYWORD_RESULT_LIMIT} of ${hits.length} ranked matches. Refine the keyword for tighter results.`
      : undefined;

  return renderReport({
    title: TITLES.apiLookup,
    metadata: buildKeywordMetadata(query, category, "ranked"),
    body: { outcome: "result", body: table },
    notes: truncatedNote,
  });
}

function buildKeywordMetadata(
  query: string,
  category: string,
  match: string,
): readonly [string, string][] {
  return [
    ["Query", `\`${query}\``],
    ["Mode", "keyword"],
    ["Category", category],
    ["Match", match],
  ];
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export default tool({
  description:
    "Search local LuaLS-style WoW API annotations for function signatures, widget definitions, enums, structures, mixins, library APIs, and Lua stdlib symbols.\n\n" +
    "Usage:\n" +
    "- Pick a category to narrow the search, or use `all` (default) to search everything.\n" +
    "- Use `mode: \"symbol\"` (default) to look up a known API name, namespace, or identifier.\n" +
    "- Use `mode: \"keyword\"` to ask 'what API does X?' with a free-form natural-language phrase; results are a ranked table of function symbols whose annotation comments mention the phrase.\n" +
    "- Categories:\n" +
    "  - `api`: Blizzard documented C_/global API (e.g. `C_LootHistory`, `GetLootSlotInfo`).\n" +
    "  - `widget`: widget types (Frame, Button, StatusBar, Texture, FontString, ScrollFrame, ...).\n" +
    "  - `type`: Enum, Structure, Mixin, UnitToken, Namespace types.\n" +
    "  - `data`: CVar definitions, Classic-specific globals, Wiki-sourced data tables.\n" +
    "  - `library`: bundled libraries (Ace3, LibStub, LibSharedMedia, LibDataBroker, ...) (curated usage snippets attached for common libraries when available).\n" +
    "  - `lua`: Lua 5.1 stdlib (basic, bit, math, os, string, table).\n" +
    "  - `framexml`: FrameXML enum and template stubs.\n" +
    "  - `all`: search every category.\n" +
    "- Symbol mode runs ripgrep over the annotation files and falls back to filename matches when no content matches.\n" +
    "- Keyword mode scans `---` annotation comments (param/return/field/prose) and ranks matching function symbols by relevance.\n\n" +
    "DO NOT use this for events — use `wow-event-info`.\n" +
    "DO NOT use this for full FrameXML implementation source — use `wow-blizzard-source`.",
  args: {
    query: tool.schema
      .string()
      .describe(
        'In `symbol` mode: the API name, namespace, widget type, or enum to search for (e.g. "C_LootHistory", "GetLootSlotInfo", "StatusBar", "Enum.ItemQuality"). In `keyword` mode: a free-form natural-language phrase describing the behavior (e.g. "player class", "in combat", "container item").',
      ),
    category: tool.schema
      .enum([
        "api",
        "widget",
        "type",
        "data",
        "library",
        "lua",
        "framexml",
        "all",
      ])
      .optional()
      .default("all")
      .describe(
        'Narrow search to a single category for precision. Options: "api" (documented C_/global API), "widget" (Frame/StatusBar/Button/...), "type" (Enum/Structure/Mixin/UnitToken/Namespace), "data" (CVar/Classic/Wiki data), "library" (Ace3/LibStub/LSM/LibDataBroker/...), "lua" (Lua 5.1 stdlib), "framexml" (enum and template stubs), or "all". "all" is the broadest path and matches everything; PREFER a specific category when you know roughly where the symbol lives - it produces tighter, more relevant results and avoids cross-category collisions.',
      ),
    mode: tool.schema
      .enum(["symbol", "keyword"])
      .optional()
      .default("symbol")
      .describe(
        "Search mode. `symbol` (default) searches for API names/identifiers and returns annotation excerpts as a Lua dump; `keyword` searches the human-readable text of annotation comments and returns a ranked table of function symbols whose docs mention the phrase. Use `keyword` when you know the behavior but not the API name.",
      ),
  },
  async execute(args) {
    const { query, category = "all", mode = "symbol" } = args;

    if (!query.trim()) {
      return renderError({
        title: TITLES.apiLookup,
        metadata: [["Query", "`(empty)`"]],
        reason: "`query` must not be empty.",
        cause: "(no query provided)",
        suggestions: [
          "Pass an API name, namespace, widget type, enum, or keyword.",
          "Examples: `C_LootHistory`, `GetLootSlotInfo`, `StatusBar`, `Enum.ItemQuality`.",
        ],
      });
    }

    if (mode === "keyword") {
      return await keywordSearch(query, category);
    }

    const searchPath = resolveSearchPath(category);

    // Step 1: Case-sensitive search with generous context
    let results = await searchWithContext(query, searchPath, true, 5, 50);
    if (results) {
      const formatted = formatRgOutput(results);
      const lineCount = formatted.split("\n").length;
      const usages = await findBlizzardUsages(query, category);
      let body = "```lua\n" + formatted + "\n```";
      if (category === "library") {
        body = appendSnippetFooter(body, findLibrarySnippet(formatted));
      }
      body = appendPivotFooter(body, usages);
      return renderReport({
        title: TITLES.apiLookup,
        metadata: buildApiMetadata(query, category, "case-sensitive"),
        body: { outcome: "result", body },
        notes:
          lineCount >= 200
            ? "- Showing partial results (max 50 matches per file). Narrow your query or category for more focused results."
            : undefined,
      });
    }

    // Step 2: Case-insensitive fallback with smaller context
    results = await searchWithContext(query, searchPath, false, 3, 30);
    if (results) {
      const formatted = formatRgOutput(results);
      const usages = await findBlizzardUsages(query, category);
      let body = "```lua\n" + formatted + "\n```";
      if (category === "library") {
        body = appendSnippetFooter(body, findLibrarySnippet(formatted));
      }
      body = appendPivotFooter(body, usages);
      return renderReport({
        title: TITLES.apiLookup,
        metadata: buildApiMetadata(query, category, "case-insensitive"),
        body: { outcome: "result", body },
      });
    }

    // Step 3: Filename-based fallback
    const simplified = simplifyQuery(query);
    const matchingFiles = await findMatchingFiles(simplified, searchPath);

    if (matchingFiles.length > 0) {
      const filesToRead = matchingFiles.slice(0, 3);
      const fileContents = await Promise.all(
        filesToRead.map((f) => readFileHead(f, 200)),
      );
      const fileBlocks = fileContents
        .map(
          ({ relPath, body }) =>
            `### ${relPath}\n\n\`\`\`lua\n${body}\n\`\`\``,
        )
        .join("\n\n");

      const intro = `No content matches for \`${query}\`, but found file(s) with \`${simplified}\` in the name:\n\n`;
      const usages = await findBlizzardUsages(query, category);
      const body = appendPivotFooter(intro + fileBlocks, usages);
      return renderReport({
        title: TITLES.apiLookup,
        metadata: buildApiMetadata(query, category, "filename"),
        body: { outcome: "result", body },
        notes:
          matchingFiles.length > 3
            ? `- ${matchingFiles.length - 3} more file(s) matched. Refine your query to see them.`
            : undefined,
      });
    }

    // Nothing found
    return renderNoMatch({
      title: TITLES.apiLookup,
      metadata: buildApiMetadata(query, category, "none"),
      paragraph: `No annotation entries matched the query \`${query}\` in category \`${category}\` (tried case-sensitive content search, case-insensitive content search, and filename match).`,
      suggestions: [
        `Try a broader category (e.g. \`all\` instead of \`${category}\`)`,
        `Search for the namespace prefix (e.g. \`C_Loot\` instead of \`C_Loot.GetLootSlotInfo\`)`,
        `Search for the function name alone (e.g. \`GetLootSlotInfo\`)`,
        `Check spelling - WoW API names are case-sensitive`,
      ],
    });
  },
});
