// tools/wow-mixin-resolver.ts
//
// Resolves Lua mixin and XML template inheritance chains across Blizzard's
// FrameXML annotation tree. One tool, three kinds (`mixin | template | auto`).
//
// Architecture (per ADR 0001, Wave 3 Feature #4):
//
//   - One per-invocation mixin index (single `runRg` pass over `*.lua`).
//   - Recursive walk with cycle-set + depth cap (default 8, max 16).
//   - XML start-tag parsing via targeted regex; tag-presence checks for
//     scripts; direct-child-frame extraction within a depth-counted slice.
//   - Multi-flavor via `resolveFrameXMLBase(version)` from
//     `wow-blizzard-source`. Direct `runRg` calls (NOT `searchBlizzardSource`,
//     whose output shape is wrong for structured resolution).
//   - All paths in user-facing output pass through `stripBasePath` so absolute
//     filesystem paths never leak.

import { tool } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import {
  renderError,
  renderNoMatch,
  renderReport,
  runRg,
  stripBasePath,
  TITLES,
  type MetadataPair,
} from "./_shared";
import { resolveFrameXMLBase } from "./wow-blizzard-source";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResolverKind = "mixin" | "template" | "auto";
type Version = "live" | "classic" | "classic_era" | "classic_anniversary";

interface MixinDef {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

interface MixinDefs {
  readonly first: MixinDef;
  readonly duplicates: readonly MixinDef[]; // additional definitions, if any
}

interface TemplateDef {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly element: string; // "Frame", "Button", ...
  readonly inherits: readonly string[];
  readonly mixins: readonly string[];
  readonly slice: string; // start tag through matching close tag
}

interface MethodEntry {
  readonly method: string;
  readonly source: string;
  readonly file: string;
  readonly line: number;
}

interface ScriptEntry {
  readonly script: string;
  readonly source: string;
  readonly file: string;
  readonly line: number;
}

interface ChildFrame {
  readonly name: string | undefined;
  readonly element: string;
  readonly template: string | undefined;
  readonly source: string;
}

type ChainVia =
  | "self"
  | "Mixin"
  | "CreateFromMixins"
  | "inherits"
  | "mixin-attr";

interface ChainNode {
  readonly name: string;
  readonly via: ChainVia;
  readonly children: ChainNode[];
  truncated?: "cycle" | "depth";
  missing?: boolean;
}

interface MixinResolution {
  readonly chain: ChainNode;
  readonly methods: readonly MethodEntry[];
  readonly mixinCount: number;
  readonly maxDepthReached: number;
}

interface TemplateResolution {
  readonly chain: ChainNode;
  readonly methods: readonly MethodEntry[];
  readonly scripts: readonly ScriptEntry[];
  readonly children: readonly ChildFrame[];
  readonly templateCount: number;
  readonly mixinCount: number;
  readonly maxDepthReached: number;
}

const DEPTH_DEFAULT = 8;
const DEPTH_MAX = 16;

// ---------------------------------------------------------------------------
// Mixin index
// ---------------------------------------------------------------------------

/**
 * Build the per-invocation mixin index via one `rg` pass.
 *
 * Captures both forms of mixin definition:
 *   - `FooMixin = {`
 *   - `FooMixin = CreateFromMixins(...)`
 *
 * The first definition by file-path order wins; additional definitions are
 * recorded as duplicates so the renderer can surface the ambiguity.
 */
async function buildMixinIndex(
  framexmlBase: string,
): Promise<Map<string, MixinDefs>> {
  const raw = await runRg([
    "--no-heading",
    "-n",
    "--glob",
    "*.lua",
    "^\\s*(\\w+Mixin)\\s*=\\s*(?:\\{|CreateFromMixins)",
    framexmlBase,
  ]);
  const index = new Map<string, MixinDefs>();
  if (!raw) return index;

  for (const line of raw.split("\n")) {
    const parsed = parseRgLine(line);
    if (!parsed) continue;
    const nameMatch = /^\s*(\w+Mixin)\s*=/.exec(parsed.text);
    if (!nameMatch) continue;
    const def: MixinDef = {
      name: nameMatch[1],
      file: parsed.file,
      line: parsed.line,
    };
    const existing = index.get(def.name);
    if (!existing) {
      index.set(def.name, { first: def, duplicates: [] });
      continue;
    }
    index.set(def.name, {
      first: existing.first,
      duplicates: [...existing.duplicates, def],
    });
  }
  return index;
}

interface RgLine {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Parse one ripgrep `--no-heading -n` line: `<file>:<line>:<text>`. File paths
 * on darwin/linux do not contain `:`, so the first two colons are unambiguous.
 */
function parseRgLine(raw: string): RgLine | null {
  const firstColon = raw.indexOf(":");
  if (firstColon === -1) return null;
  const secondColon = raw.indexOf(":", firstColon + 1);
  if (secondColon === -1) return null;
  const lineNum = Number(raw.slice(firstColon + 1, secondColon));
  if (!Number.isFinite(lineNum)) return null;
  return {
    file: raw.slice(0, firstColon),
    line: lineNum,
    text: raw.slice(secondColon + 1),
  };
}

// ---------------------------------------------------------------------------
// File reading (cached per invocation)
// ---------------------------------------------------------------------------

type FileCache = Map<string, string>;

async function readFileCached(
  cache: FileCache,
  absolutePath: string,
): Promise<string> {
  const cached = cache.get(absolutePath);
  if (cached !== undefined) return cached;
  const text = await readFile(absolutePath, "utf8");
  cache.set(absolutePath, text);
  return text;
}

/**
 * Slice a Lua file from a mixin's definition line to the next mixin definition
 * or EOF. Used to scope method extraction and composed-mixin extraction so
 * that a file containing multiple mixins doesn't cross-contaminate.
 */
function sliceMixinScope(text: string, defLine: number): string {
  const lines = text.split("\n");
  const startIdx = defLine - 1;
  if (startIdx < 0 || startIdx >= lines.length) return "";
  const otherDefRe = /^\s*\w+Mixin\s*=\s*(?:\{|CreateFromMixins)/;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (otherDefRe.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

// ---------------------------------------------------------------------------
// Mixin method + composition extraction
// ---------------------------------------------------------------------------

function extractMixinMethods(
  def: MixinDef,
  scope: string,
): MethodEntry[] {
  const methods: MethodEntry[] = [];
  const scopeLines = scope.split("\n");
  const re = new RegExp(
    `^\\s*function\\s+${escapeRe(def.name)}\\s*[:.](\\w+)`,
  );
  for (let i = 0; i < scopeLines.length; i++) {
    const m = re.exec(scopeLines[i]);
    if (!m) continue;
    methods.push({
      method: m[1],
      source: def.name,
      file: def.file,
      line: def.line + i,
    });
  }
  return methods;
}

interface ComposedRef {
  readonly via: "Mixin" | "CreateFromMixins";
  readonly name: string;
}

/**
 * Extract composed mixin references from a mixin's defining-file scope.
 *
 * Recognizes:
 *   - `Mixin(<target>, A, B, C)` (any target — `self`, a frame variable, etc.)
 *   - `CreateFromMixins(A, B, C)`
 *
 * Filters captured identifiers to those ending in `Mixin` (per ADR step 3).
 */
function extractComposedMixins(scope: string): ComposedRef[] {
  const refs: ComposedRef[] = [];
  const mixinCallRe = /\bMixin\s*\(([^)]*)\)/g;
  const fromMixinsRe = /\bCreateFromMixins\s*\(([^)]*)\)/g;

  for (const match of scope.matchAll(mixinCallRe)) {
    const args = splitArgs(match[1]);
    // First arg is the target (e.g. `self`); skip it.
    for (const name of args.slice(1)) {
      if (isMixinIdent(name)) refs.push({ via: "Mixin", name });
    }
  }
  for (const match of scope.matchAll(fromMixinsRe)) {
    const args = splitArgs(match[1]);
    for (const name of args) {
      if (isMixinIdent(name)) refs.push({ via: "CreateFromMixins", name });
    }
  }
  return dedupeRefs(refs);
}

function splitArgs(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isMixinIdent(s: string): boolean {
  return /^\w+Mixin$/.test(s);
}

function dedupeRefs(refs: ComposedRef[]): ComposedRef[] {
  const seen = new Set<string>();
  const out: ComposedRef[] = [];
  for (const ref of refs) {
    const key = `${ref.via}:${ref.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Mixin resolver (recursive)
// ---------------------------------------------------------------------------

interface ResolverContext {
  readonly index: Map<string, MixinDefs>;
  readonly framexmlBase: string;
  readonly fileCache: FileCache;
  readonly visited: Set<string>;
  readonly counters: { mixins: number; templates: number; depth: number };
}

async function resolveMixinNode(
  name: string,
  via: ChainVia,
  ctx: ResolverContext,
  depthRemaining: number,
  currentDepth: number,
): Promise<{ chain: ChainNode; methods: MethodEntry[] }> {
  const node: ChainNode = { name, via, children: [] };
  const defs = ctx.index.get(name);

  if (!defs) {
    node.missing = true;
    return { chain: node, methods: [] };
  }
  const cycleKey = `mixin:${name}`;
  if (ctx.visited.has(cycleKey)) {
    node.truncated = "cycle";
    return { chain: node, methods: [] };
  }
  if (depthRemaining <= 0) {
    node.truncated = "depth";
    return { chain: node, methods: [] };
  }

  ctx.visited.add(cycleKey);
  ctx.counters.mixins += 1;
  if (currentDepth > ctx.counters.depth) ctx.counters.depth = currentDepth;

  const fileText = await readFileCached(ctx.fileCache, defs.first.file);
  const scope = sliceMixinScope(fileText, defs.first.line);
  const methods = extractMixinMethods(defs.first, scope);
  const composed = extractComposedMixins(scope);

  const allMethods: MethodEntry[] = [...methods];
  for (const ref of composed) {
    const child = await resolveMixinNode(
      ref.name,
      ref.via,
      ctx,
      depthRemaining - 1,
      currentDepth + 1,
    );
    node.children.push(child.chain);
    allMethods.push(...child.methods);
  }
  return { chain: node, methods: allMethods };
}

// ---------------------------------------------------------------------------
// Template lookup + parsing
// ---------------------------------------------------------------------------

/**
 * Locate a template definition. Templates are declared in raw `*.xml` files
 * as `<Tag name="X" .../>` with an optional `virtual="true"` attribute. We
 * accept any tag name (Frame, Button, StatusBar, ScrollFrame, ...).
 */
async function findTemplateDef(
  name: string,
  framexmlBase: string,
  fileCache: FileCache,
): Promise<TemplateDef | null> {
  const raw = await runRg([
    "--no-heading",
    "-n",
    "--glob",
    "*.xml",
    `<\\w+\\s+[^>]*name="${escapeRe(name)}"`,
    framexmlBase,
  ]);
  if (!raw) return null;

  for (const line of raw.split("\n")) {
    const parsed = parseRgLine(line);
    if (!parsed) continue;
    const fileText = await readFileCached(fileCache, parsed.file);
    const located = locateTemplateInFile(fileText, name, parsed.line);
    if (located) {
      return {
        name,
        file: parsed.file,
        line: located.startLine,
        element: located.element,
        inherits: located.inherits,
        mixins: located.mixins,
        slice: located.slice,
      };
    }
  }
  return null;
}

interface LocatedTemplate {
  readonly startLine: number;
  readonly element: string;
  readonly inherits: readonly string[];
  readonly mixins: readonly string[];
  readonly slice: string;
}

/**
 * Given a candidate hit at `hitLine`, walk forward to capture the full start
 * tag (multi-line attributes), parse it, and slice through to the matching
 * close tag (or self-close). Returns null if the hit is not actually the
 * named template's start tag (e.g. `name="X"` appearing elsewhere).
 */
function locateTemplateInFile(
  fileText: string,
  name: string,
  hitLine: number,
): LocatedTemplate | null {
  const lines = fileText.split("\n");
  const idx = hitLine - 1;
  if (idx < 0 || idx >= lines.length) return null;

  const startTagRe = new RegExp(
    `<(\\w+)\\b[^>]*\\bname="${escapeRe(name)}"`,
  );
  const startMatch = startTagRe.exec(lines[idx]);
  if (!startMatch) return null;
  const element = startMatch[1];

  const tagJoined = joinUntilTagEnd(lines, idx);
  if (!tagJoined) return null;
  const parsed = parseTemplateStartTag(tagJoined.tagText);
  if (!parsed) return null;

  const slice = sliceTemplateElement(
    lines,
    idx,
    element,
    tagJoined.endLineIdx,
    tagJoined.selfClosing,
  );

  return {
    startLine: hitLine,
    element,
    inherits: parsed.inherits,
    mixins: parsed.mixins,
    slice,
  };
}

interface JoinedTag {
  readonly tagText: string;
  readonly endLineIdx: number;
  readonly selfClosing: boolean;
}

function joinUntilTagEnd(lines: string[], startIdx: number): JoinedTag | null {
  const buf: string[] = [];
  for (let i = startIdx; i < lines.length && i < startIdx + 30; i++) {
    buf.push(lines[i]);
    const joined = buf.join(" ");
    const closeIdx = joined.indexOf(">");
    if (closeIdx === -1) continue;
    const tagText = joined.slice(0, closeIdx + 1);
    const selfClosing = /\/\s*>$/.test(tagText.trim());
    return { tagText, endLineIdx: i, selfClosing };
  }
  return null;
}

interface ParsedStartTag {
  readonly inherits: readonly string[];
  readonly mixins: readonly string[];
}

/**
 * Parse the `inherits` and `mixin` attribute values out of an XML start tag.
 *
 * `inherits="A, B, C"` is comma-separated. `mixin="X"` is usually a single
 * identifier but is split defensively on whitespace and commas.
 */
function parseTemplateStartTag(tagText: string): ParsedStartTag | null {
  const inheritsAttr = /\binherits="([^"]*)"/.exec(tagText);
  const mixinAttr = /\bmixin="([^"]*)"/.exec(tagText);
  const inherits = inheritsAttr
    ? splitWhitespaceOrComma(inheritsAttr[1])
    : [];
  const mixins = mixinAttr ? splitWhitespaceOrComma(mixinAttr[1]) : [];
  return { inherits, mixins };
}

function splitWhitespaceOrComma(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Slice from the element's start tag through its matching close tag using a
 * depth counter over `<Element` / `</Element>` pairs. Self-closing tags
 * (`<Element ... />`) and the start tag's own opening are accounted for so
 * the counter only reflects nested element pairs.
 */
function sliceTemplateElement(
  lines: string[],
  startIdx: number,
  element: string,
  startTagEndIdx: number,
  selfClosing: boolean,
): string {
  if (selfClosing) return lines.slice(startIdx, startTagEndIdx + 1).join("\n");

  // After the start tag, we are inside the element at depth 1. Count nested
  // open/close pairs of the same element name; ignore self-closing siblings.
  const openRe = new RegExp(`<${escapeRe(element)}\\b[^>]*?(/\\s*)?>`, "g");
  const closeRe = new RegExp(`</${escapeRe(element)}\\s*>`, "g");
  let depth = 1;
  for (let i = startTagEndIdx + 1; i < lines.length; i++) {
    const opens = countNonSelfClosing(lines[i], openRe);
    const closes = (lines[i].match(closeRe) ?? []).length;
    depth += opens - closes;
    if (depth <= 0) {
      return lines.slice(startIdx, i + 1).join("\n");
    }
  }
  return lines.slice(startIdx).join("\n");
}

/**
 * Count opening tags of `<Element ...>` that are NOT self-closing on the
 * given line. The regex captures the optional trailing `/` so we can filter.
 */
function countNonSelfClosing(line: string, openRe: RegExp): number {
  let count = 0;
  for (const match of line.matchAll(openRe)) {
    const isSelfClosing = match[1] !== undefined;
    if (!isSelfClosing) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Template scripts + child frames
// ---------------------------------------------------------------------------

const SCRIPT_TAGS = [
  "OnLoad",
  "OnEvent",
  "OnShow",
  "OnHide",
  "OnClick",
  "OnUpdate",
  "OnEnter",
  "OnLeave",
  "OnMouseDown",
  "OnMouseUp",
  "OnDragStart",
  "OnDragStop",
  "OnReceiveDrag",
  "OnKeyDown",
  "OnKeyUp",
  "OnSizeChanged",
  "OnAttributeChanged",
] as const;

const CHILD_ELEMENTS = [
  "Frame",
  "Button",
  "StatusBar",
  "EditBox",
  "FontString",
  "Texture",
  "CheckButton",
  "ScrollFrame",
  "ItemButton",
  "Slider",
  "ModelScene",
] as const;

function extractTemplateScripts(
  def: TemplateDef,
): ScriptEntry[] {
  const scripts: ScriptEntry[] = [];
  const sliceLines = def.slice.split("\n");
  for (const tag of SCRIPT_TAGS) {
    const re = new RegExp(`<${tag}\\b`);
    for (let i = 0; i < sliceLines.length; i++) {
      if (!re.test(sliceLines[i])) continue;
      scripts.push({
        script: tag,
        source: def.name,
        file: def.file,
        line: def.line + i,
      });
      break; // one entry per script tag per template
    }
  }
  return scripts;
}

function extractChildFrames(def: TemplateDef): ChildFrame[] {
  const sliceLines = def.slice.split("\n");
  // Direct children only: track depth from the root element. The start tag
  // itself is depth 1; descend into <Frames>...</Frames> blocks (depth-neutral
  // wrapper) to find child element start tags at depth 2.
  const children: ChildFrame[] = [];
  let inFramesBlock = false;
  for (let i = 1; i < sliceLines.length; i++) {
    const line = sliceLines[i];
    if (/<Frames\s*>/.test(line)) {
      inFramesBlock = true;
      continue;
    }
    if (/<\/Frames>/.test(line)) {
      inFramesBlock = false;
      continue;
    }
    if (!inFramesBlock) continue;
    const childRe = new RegExp(
      `<(${CHILD_ELEMENTS.join("|")})\\b([^>]*)`,
    );
    const m = childRe.exec(line);
    if (!m) continue;
    const attrs = m[2];
    const nameAttr = /\bname="([^"]*)"/.exec(attrs);
    const parentKeyAttr = /\bparentKey="([^"]*)"/.exec(attrs);
    const inheritsAttr = /\binherits="([^"]*)"/.exec(attrs);
    children.push({
      name: nameAttr?.[1] ?? parentKeyAttr?.[1],
      element: m[1],
      template: inheritsAttr?.[1],
      source: def.name,
    });
  }
  return children;
}

// ---------------------------------------------------------------------------
// Template resolver (recursive)
// ---------------------------------------------------------------------------

async function resolveTemplateNode(
  name: string,
  via: ChainVia,
  ctx: ResolverContext,
  depthRemaining: number,
  currentDepth: number,
): Promise<{
  chain: ChainNode;
  methods: MethodEntry[];
  scripts: ScriptEntry[];
  children: ChildFrame[];
  rootDef: TemplateDef | null;
}> {
  const node: ChainNode = { name, via, children: [] };
  const cycleKey = `template:${name}`;
  if (ctx.visited.has(cycleKey)) {
    node.truncated = "cycle";
    return { chain: node, methods: [], scripts: [], children: [], rootDef: null };
  }
  if (depthRemaining <= 0) {
    node.truncated = "depth";
    return { chain: node, methods: [], scripts: [], children: [], rootDef: null };
  }

  const def = await findTemplateDef(name, ctx.framexmlBase, ctx.fileCache);
  if (!def) {
    node.missing = true;
    return { chain: node, methods: [], scripts: [], children: [], rootDef: null };
  }
  ctx.visited.add(cycleKey);
  ctx.counters.templates += 1;
  if (currentDepth > ctx.counters.depth) ctx.counters.depth = currentDepth;

  const scripts = extractTemplateScripts(def);
  const children = extractChildFrames(def);

  const allMethods: MethodEntry[] = [];
  const allScripts: ScriptEntry[] = [...scripts];

  // Inherits chain (each is itself a template).
  for (const parent of def.inherits) {
    const sub = await resolveTemplateNode(
      parent,
      "inherits",
      ctx,
      depthRemaining - 1,
      currentDepth + 1,
    );
    node.children.push(sub.chain);
    allMethods.push(...sub.methods);
    allScripts.push(...sub.scripts);
  }
  // Mixin attributes (cross-resolve as mixins).
  for (const mixinName of def.mixins) {
    const sub = await resolveMixinNode(
      mixinName,
      "mixin-attr",
      ctx,
      depthRemaining - 1,
      currentDepth + 1,
    );
    node.children.push(sub.chain);
    allMethods.push(...sub.methods);
  }
  return { chain: node, methods: allMethods, scripts: allScripts, children, rootDef: def };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderInheritanceChain(root: ChainNode): string {
  const lines: string[] = [];
  renderChainNode(root, 0, lines);
  return lines.join("\n");
}

function renderChainNode(
  node: ChainNode,
  indent: number,
  out: string[],
): void {
  const pad = "  ".repeat(indent);
  const viaLabel = describeVia(node.via);
  const suffix = describeChainSuffix(node);
  const nameLabel = node.missing ? `${node.name} (not found)` : node.name;
  const viaPart = viaLabel ? ` ${viaLabel}` : "";
  out.push(`${pad}- ${nameLabel}${viaPart}${suffix}`);
  for (const child of node.children) {
    renderChainNode(child, indent + 1, out);
  }
}

function describeVia(via: ChainVia): string {
  if (via === "self") return "";
  if (via === "Mixin") return "(via Mixin)";
  if (via === "CreateFromMixins") return "(via CreateFromMixins)";
  if (via === "inherits") return "(inherits)";
  return "(mixin attribute)";
}

function describeChainSuffix(node: ChainNode): string {
  if (node.truncated === "cycle") return " — (cycle)";
  if (node.truncated === "depth") return " — (depth-exceeded)";
  return "";
}

function renderMethodsTable(
  methods: readonly MethodEntry[],
  framexmlBase: string,
): string {
  if (methods.length === 0) return "_No methods detected._";
  const rows = methods.map(
    (m) =>
      `| ${m.method} | ${m.source} | ${stripBasePath(framexmlBase, m.file)}:${m.line} |`,
  );
  return (
    "| Method | Source | File |\n" +
    "|---|---|---|\n" +
    rows.join("\n")
  );
}

function renderScriptsTable(
  scripts: readonly ScriptEntry[],
  framexmlBase: string,
): string {
  if (scripts.length === 0) return "_No script handlers detected._";
  const rows = scripts.map(
    (s) =>
      `| ${s.script} | ${s.source} | ${stripBasePath(framexmlBase, s.file)}:${s.line} |`,
  );
  return (
    "| Script | Defined In | File |\n" +
    "|---|---|---|\n" +
    rows.join("\n")
  );
}

function renderChildFramesTable(children: readonly ChildFrame[]): string {
  if (children.length === 0) return "_No direct child frames._";
  const rows = children.map(
    (c) =>
      `| ${c.name ?? "(unnamed)"} | ${c.element} | ${c.template ?? "—"} | ${c.source} |`,
  );
  return (
    "| Child | Element | Template | From |\n" +
    "|---|---|---|---|\n" +
    rows.join("\n")
  );
}

// ---------------------------------------------------------------------------
// Result body assembly
// ---------------------------------------------------------------------------

interface MixinBodyParts {
  readonly framexmlBase: string;
  readonly def: MixinDef;
  readonly resolution: MixinResolution;
}

function buildMixinResultBody(parts: MixinBodyParts): string {
  const { framexmlBase, def, resolution } = parts;
  const sections = [
    "### Definition",
    "",
    `Defined as a Lua mixin in \`${stripBasePath(framexmlBase, def.file)}:${def.line}\`.`,
    "",
    "### Inheritance Chain",
    "",
    renderInheritanceChain(resolution.chain),
    "",
    "### Methods",
    "",
    renderMethodsTable(resolution.methods, framexmlBase),
  ];
  return sections.join("\n");
}

interface TemplateBodyParts {
  readonly framexmlBase: string;
  readonly def: TemplateDef;
  readonly resolution: TemplateResolution;
}

function buildTemplateResultBody(parts: TemplateBodyParts): string {
  const { framexmlBase, def, resolution } = parts;
  const sections = [
    "### Definition",
    "",
    `Defined as a \`<${def.element}>\` template in \`${stripBasePath(framexmlBase, def.file)}:${def.line}\`.`,
    "",
    "### Inheritance Chain",
    "",
    renderInheritanceChain(resolution.chain),
    "",
    "### Methods",
    "",
    renderMethodsTable(resolution.methods, framexmlBase),
    "",
    "### Scripts",
    "",
    renderScriptsTable(resolution.scripts, framexmlBase),
    "",
    "### Child Frames",
    "",
    renderChildFramesTable(resolution.children),
  ];
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Notes assembly
// ---------------------------------------------------------------------------

interface NotesParts {
  readonly counters: { mixins: number; templates: number; depth: number };
  readonly depthCap: number;
  readonly duplicates?: readonly MixinDef[];
  readonly framexmlBase: string;
}

function buildNotes(parts: NotesParts): string | undefined {
  const { counters, depthCap, duplicates, framexmlBase } = parts;
  const lines: string[] = [];
  const summary = [
    counters.mixins > 0 ? `${counters.mixins} mixin(s)` : null,
    counters.templates > 0 ? `${counters.templates} template(s)` : null,
  ]
    .filter((s): s is string => s !== null)
    .join(" + ");
  if (summary) {
    lines.push(`- ${summary} resolved, depth ${counters.depth} of ${depthCap}.`);
  }
  if (duplicates && duplicates.length > 0) {
    lines.push("- Additional mixin definitions found (first one rendered):");
    for (const dup of duplicates) {
      lines.push(`  - \`${stripBasePath(framexmlBase, dup.file)}:${dup.line}\``);
    }
  }
  if (counters.depth >= depthCap) {
    lines.push(
      `- Depth cap of ${depthCap} reached; raise \`depth\` to walk further (max ${DEPTH_MAX}).`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

interface ResolverMetadataOpts {
  readonly query: string;
  readonly kind: ResolverKind;
  readonly version?: Version;
  readonly depth: number;
  readonly match: "mixin" | "template" | "ambiguous" | "none";
}

function buildResolverMetadata(opts: ResolverMetadataOpts): MetadataPair[] {
  const metadata: MetadataPair[] = [
    ["Query", `\`${opts.query || "(empty)"}\``],
    ["Kind", opts.kind],
  ];
  if (opts.version) metadata.push(["Version", opts.version]);
  metadata.push(["Depth", String(opts.depth)]);
  metadata.push(["Match", opts.match]);
  return metadata;
}

// ---------------------------------------------------------------------------
// Top-level resolver dispatch
// ---------------------------------------------------------------------------

interface DispatchInput {
  readonly query: string;
  readonly kind: ResolverKind;
  readonly version: Version | undefined;
  readonly depth: number;
  readonly framexmlBase: string;
}

interface DispatchOutput {
  readonly report: string;
}

async function dispatch(input: DispatchInput): Promise<DispatchOutput> {
  const { query, kind, version, depth, framexmlBase } = input;
  const fileCache: FileCache = new Map();
  const index = await buildMixinIndex(framexmlBase);

  if (kind === "mixin") {
    return {
      report: await renderMixinPath({
        query,
        kind,
        version,
        depth,
        framexmlBase,
        fileCache,
        index,
      }),
    };
  }
  if (kind === "template") {
    return {
      report: await renderTemplatePath({
        query,
        kind,
        version,
        depth,
        framexmlBase,
        fileCache,
        index,
      }),
    };
  }
  return {
    report: await renderAutoPath({
      query,
      version,
      depth,
      framexmlBase,
      fileCache,
      index,
    }),
  };
}

// ---------------------------------------------------------------------------
// Mixin path
// ---------------------------------------------------------------------------

interface PathContext {
  readonly query: string;
  readonly kind: ResolverKind;
  readonly version?: Version;
  readonly depth: number;
  readonly framexmlBase: string;
  readonly fileCache: FileCache;
  readonly index: Map<string, MixinDefs>;
}

async function renderMixinPath(ctx: PathContext): Promise<string> {
  const defs = ctx.index.get(ctx.query);
  if (!defs) {
    return renderNoMatch({
      title: TITLES.mixinResolver,
      metadata: buildResolverMetadata({
        query: ctx.query,
        kind: ctx.kind,
        version: ctx.version,
        depth: ctx.depth,
        match: "none",
      }),
      paragraph: `No Lua mixin named \`${ctx.query}\` was found in the resolved FrameXML tree.`,
      suggestions: [
        'Try `kind: "template"` if the name refers to an XML template.',
        "Check spelling — mixin names are case-sensitive (e.g. `LootFrameMixin`).",
        "Use `wow-blizzard-source` to grep for the name in case it lives outside the indexed `*.lua` files.",
      ],
    });
  }
  const resolution = await runMixinResolution(ctx, defs);
  return renderReport({
    title: TITLES.mixinResolver,
    metadata: buildResolverMetadata({
      query: ctx.query,
      kind: ctx.kind,
      version: ctx.version,
      depth: ctx.depth,
      match: "mixin",
    }),
    body: {
      outcome: "result",
      body: buildMixinResultBody({
        framexmlBase: ctx.framexmlBase,
        def: defs.first,
        resolution,
      }),
    },
    notes: buildNotes({
      counters: resolution.counters,
      depthCap: ctx.depth,
      duplicates: defs.duplicates,
      framexmlBase: ctx.framexmlBase,
    }),
  });
}

async function runMixinResolution(
  ctx: PathContext,
  defs: MixinDefs,
): Promise<MixinResolution & { counters: ResolverContext["counters"] }> {
  const counters = { mixins: 0, templates: 0, depth: 0 };
  const resolverCtx: ResolverContext = {
    index: ctx.index,
    framexmlBase: ctx.framexmlBase,
    fileCache: ctx.fileCache,
    visited: new Set<string>(),
    counters,
  };
  const result = await resolveMixinNode(
    defs.first.name,
    "self",
    resolverCtx,
    ctx.depth,
    1,
  );
  return {
    chain: result.chain,
    methods: result.methods,
    mixinCount: counters.mixins,
    maxDepthReached: counters.depth,
    counters,
  };
}

// ---------------------------------------------------------------------------
// Template path
// ---------------------------------------------------------------------------

async function renderTemplatePath(ctx: PathContext): Promise<string> {
  const counters = { mixins: 0, templates: 0, depth: 0 };
  const resolverCtx: ResolverContext = {
    index: ctx.index,
    framexmlBase: ctx.framexmlBase,
    fileCache: ctx.fileCache,
    visited: new Set<string>(),
    counters,
  };
  const result = await resolveTemplateNode(
    ctx.query,
    "self",
    resolverCtx,
    ctx.depth,
    1,
  );
  if (!result.rootDef) {
    return renderNoMatch({
      title: TITLES.mixinResolver,
      metadata: buildResolverMetadata({
        query: ctx.query,
        kind: ctx.kind,
        version: ctx.version,
        depth: ctx.depth,
        match: "none",
      }),
      paragraph: `No XML template named \`${ctx.query}\` was found in the resolved FrameXML tree.`,
      suggestions: [
        'Try `kind: "mixin"` if the name refers to a Lua mixin.',
        "Check spelling — template names are case-sensitive (e.g. `ButtonFrameTemplate`).",
        "Use `wow-blizzard-source` to grep for the name across `*.xml` files.",
      ],
    });
  }
  const resolution: TemplateResolution = {
    chain: result.chain,
    methods: result.methods,
    scripts: result.scripts,
    children: result.children,
    templateCount: counters.templates,
    mixinCount: counters.mixins,
    maxDepthReached: counters.depth,
  };
  return renderReport({
    title: TITLES.mixinResolver,
    metadata: buildResolverMetadata({
      query: ctx.query,
      kind: ctx.kind,
      version: ctx.version,
      depth: ctx.depth,
      match: "template",
    }),
    body: {
      outcome: "result",
      body: buildTemplateResultBody({
        framexmlBase: ctx.framexmlBase,
        def: result.rootDef,
        resolution,
      }),
    },
    notes: buildNotes({
      counters,
      depthCap: ctx.depth,
      framexmlBase: ctx.framexmlBase,
    }),
  });
}

// ---------------------------------------------------------------------------
// Auto path
// ---------------------------------------------------------------------------

interface AutoPathContext {
  readonly query: string;
  readonly version?: Version;
  readonly depth: number;
  readonly framexmlBase: string;
  readonly fileCache: FileCache;
  readonly index: Map<string, MixinDefs>;
}

async function renderAutoPath(ctx: AutoPathContext): Promise<string> {
  const mixinDefs = ctx.index.get(ctx.query);
  const templateDef = await findTemplateDef(
    ctx.query,
    ctx.framexmlBase,
    ctx.fileCache,
  );
  const hasMixin = mixinDefs !== undefined;
  const hasTemplate = templateDef !== null;

  if (hasMixin && hasTemplate) {
    return renderAmbiguous(ctx, mixinDefs, templateDef);
  }
  if (!hasMixin && !hasTemplate) {
    return renderNoMatch({
      title: TITLES.mixinResolver,
      metadata: buildResolverMetadata({
        query: ctx.query,
        kind: "auto",
        version: ctx.version,
        depth: ctx.depth,
        match: "none",
      }),
      paragraph: `No Lua mixin or XML template named \`${ctx.query}\` was found.`,
      suggestions: [
        'Set `kind: "mixin"` or `kind: "template"` to force a specific resolution path.',
        "Check spelling — names are case-sensitive.",
        "Use `wow-blizzard-source` to grep for the name across the FrameXML tree.",
      ],
    });
  }
  // Exactly one resolved — replay through the kind-specific path so metadata
  // and notes stay consistent with explicit-kind invocations.
  const path: PathContext = {
    query: ctx.query,
    kind: "auto",
    version: ctx.version,
    depth: ctx.depth,
    framexmlBase: ctx.framexmlBase,
    fileCache: ctx.fileCache,
    index: ctx.index,
  };
  return hasMixin
    ? await renderMixinPath(path)
    : await renderTemplatePath(path);
}

function renderAmbiguous(
  ctx: AutoPathContext,
  mixinDefs: MixinDefs,
  templateDef: TemplateDef,
): string {
  const mixinPath = `${stripBasePath(ctx.framexmlBase, mixinDefs.first.file)}:${mixinDefs.first.line}`;
  const templatePath = `${stripBasePath(ctx.framexmlBase, templateDef.file)}:${templateDef.line}`;
  return renderNoMatch({
    title: TITLES.mixinResolver,
    metadata: buildResolverMetadata({
      query: ctx.query,
      kind: "auto",
      version: ctx.version,
      depth: ctx.depth,
      match: "ambiguous",
    }),
    paragraph:
      `\`${ctx.query}\` resolves as **both** a Lua mixin AND an XML template — ambiguous in \`auto\` mode. ` +
      `Set \`kind\` explicitly to disambiguate.\n\n` +
      `- Mixin definition: \`${mixinPath}\`\n` +
      `- Template definition (\`<${templateDef.element}>\`): \`${templatePath}\``,
    suggestions: [
      'Re-invoke with `kind: "mixin"` to resolve the Lua mixin chain.',
      'Re-invoke with `kind: "template"` to resolve the XML template chain.',
    ],
  });
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export default tool({
  description:
    "Resolve Lua mixin and XML template inheritance chains across Blizzard's FrameXML annotation tree. Returns the inheritance graph, every method/script/child contribution, and where each one is defined.\n\n" +
    "Usage:\n" +
    '- `query`: the mixin or template name (e.g. "LootFrameMixin", "ButtonFrameTemplate", "ItemButtonTemplate").\n' +
    '- `kind`: "mixin" treats `query` as a Lua mixin name; "template" as an XML template; "auto" (default) infers from the suffix and falls back to trying both. If both kinds match in `auto`, the tool surfaces an ambiguous result and asks the caller to pick.\n' +
    '- `version`: FrameXML annotation flavor ("live", "classic", "classic_era", "classic_anniversary"). Omit to use the legacy single-flavor submodule.\n' +
    "- `depth`: maximum inheritance depth to walk (default 8, max 16). Truncated walks are explicitly marked in the output.\n\n" +
    "DO NOT use this for raw greps over FrameXML — use `wow-blizzard-source` for that. DO NOT use this for documented C_ APIs — use `wow-api-lookup`.",
  args: {
    query: tool.schema
      .string()
      .describe(
        'Mixin or template name. Examples: "LootFrameMixin", "LootCustomFrameTemplate", "ItemButtonTemplate".',
      ),
    kind: tool.schema
      .enum(["mixin", "template", "auto"])
      .optional()
      .default("auto")
      .describe(
        'Resolution mode. "mixin" treats `query` as a Lua mixin name. "template" treats it as an XML template/frame name. "auto" (default) infers from the suffix and falls back to trying both; ambiguous results surface as a no-match with both candidates listed.',
      ),
    version: tool.schema
      .enum(["live", "classic", "classic_era", "classic_anniversary"])
      .optional()
      .describe(
        'FrameXML annotation flavor. Mirrors `wow-blizzard-source`. Omit to fall back to the legacy single-flavor submodule.',
      ),
    depth: tool.schema
      .number()
      .int()
      .min(1)
      .max(DEPTH_MAX)
      .optional()
      .default(DEPTH_DEFAULT)
      .describe(
        `Maximum inheritance depth to walk (cycle-safe). Default ${DEPTH_DEFAULT}, hard cap ${DEPTH_MAX}. Truncated walks emit a "(depth-exceeded)" marker.`,
      ),
  },
  async execute(args) {
    const {
      query,
      kind = "auto",
      version,
      depth = DEPTH_DEFAULT,
    } = args;

    if (!query.trim()) {
      return renderError({
        title: TITLES.mixinResolver,
        metadata: [
          ["Query", `\`${query || "(empty)"}\``],
          ["Kind", kind],
          ["Depth", String(depth)],
        ],
        reason: "`query` must not be empty.",
        cause: "(no query provided)",
        suggestions: [
          "Pass a mixin name (e.g. `LootFrameMixin`) or template name (e.g. `ButtonFrameTemplate`).",
        ],
      });
    }

    let framexmlBase: string;
    try {
      framexmlBase = resolveFrameXMLBase(version);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return renderError({
        title: TITLES.mixinResolver,
        metadata: [
          ["Query", `\`${query}\``],
          ["Kind", kind],
          ...(version ? ([["Version", version]] as MetadataPair[]) : []),
          ["Depth", String(depth)],
        ],
        reason: "Failed to resolve FrameXML annotation source.",
        cause: message,
        suggestions: [
          "Verify wow-annotations / wow-framexml are installed (run maintain-annotations.sh).",
          "Try a different `version` flavor or omit `version` to use the legacy submodule.",
        ],
      });
    }

    const { report } = await dispatch({
      query,
      kind,
      version,
      depth,
      framexmlBase,
    });
    return report;
  },
});
