// tools/_toc.ts
//
// Pure parser for WoW addon `.toc` files. Parse-don't-validate: the result
// is a structurally honest record of what's in the file. Semantic checks
// (does the Interface number match a real WoW build, does every
// `## SavedVariables:` entry get assigned in code) are out of scope.
// Best-effort over error-on-malformed: a malformed line is recorded as a
// `parseWarning` and parsing continues. Lives at the `tools/` level so any
// future TOC-aware tool (linter, validator, packager helper) can import it
// without spinning up `wow-project-scan`'s machinery.

import path from "node:path";
import { readdirSync, type Dirent } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TocFlavor =
  | "default"
  | "mainline"
  | "vanilla"
  | "cata"
  | "wrath"
  | "tbc"
  | "mists"
  | "classic";

export type FlavorFilter = "all" | TocFlavor;

export interface TocDirective {
  readonly key: string;
  readonly value: string;
  readonly line: number;
}

export interface TocConditional {
  readonly tag: string;
  readonly negated: boolean;
  readonly active: boolean;
  readonly lines: readonly number[];
}

export interface TocFileRef {
  readonly path: string; // relative to the TOC's own directory, as written
  readonly line: number;
  readonly conditional: TocConditional | null;
}

export interface ParsedToc {
  readonly path: string;
  readonly flavor: TocFlavor;
  readonly directives: readonly TocDirective[];
  readonly fileRefs: readonly TocFileRef[];
  readonly savedVariables: readonly string[];
  readonly savedVariablesPerCharacter: readonly string[];
  readonly dependencies: readonly string[];
  readonly optionalDeps: readonly string[];
  readonly interface: string | null;
  readonly title: string | null;
  readonly version: string | null;
  readonly author: string | null;
  readonly notes: string | null;
  readonly conditionals: readonly TocConditional[];
  readonly xMetadata: ReadonlyMap<string, string>;
  readonly parseWarnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Flavor tags that conditional blocks may name. The map collapses
 * Curseforge-packager aliases (`retail` ≡ `mainline`, `classic` ≡ `vanilla`,
 * `bcc` ≡ `tbc`) onto our canonical TocFlavor set, so a `flavor` filter can
 * match a `#@retail@` block without the caller having to remember the
 * alias table.
 */
const KNOWN_FLAVOR_ALIASES: Readonly<Record<string, TocFlavor>> = {
  retail: "mainline",
  mainline: "mainline",
  vanilla: "vanilla",
  classic: "classic",
  bcc: "tbc",
  tbc: "tbc",
  wrath: "wrath",
  cata: "cata",
  mists: "mists",
};

const FILENAME_FLAVOR_PATTERN =
  /_(Mainline|Vanilla|Cata|Wrath|TBC|Mists|Classic)\.toc$/i;

// Comma-separated lists for a handful of directives.
const LIST_DIRECTIVES = new Set([
  "savedvariables",
  "savedvariablespercharacter",
  "dependencies",
  "requireddeps",
  "optionaldeps",
]);

// ---------------------------------------------------------------------------
// Filename → flavor
// ---------------------------------------------------------------------------

/**
 * Derive the TOC flavor from a filename suffix. `MyAddon_Mainline.toc` →
 * `"mainline"`. A bare `MyAddon.toc` (or anything without a recognised
 * suffix) is `"default"`.
 */
export function detectTocFlavor(filename: string): TocFlavor {
  const m = FILENAME_FLAVOR_PATTERN.exec(filename);
  if (!m) return "default";
  const tag = m[1].toLowerCase();
  return KNOWN_FLAVOR_ALIASES[tag] ?? "default";
}

// ---------------------------------------------------------------------------
// Top-level TOC discovery
// ---------------------------------------------------------------------------

/**
 * Enumerate top-level `.toc` files at an addon root. Nested TOCs (those
 * inside subdirectories) belong to embedded sub-addons and are out of scope
 * at the project level. Returns absolute paths sorted for determinism.
 */
export function tocFilesIn(addonRoot: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(addonRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.toc$/i.test(e.name)) continue;
    out.push(path.join(addonRoot, e.name));
  }
  out.sort();
  return out;
}

// ---------------------------------------------------------------------------
// Conditional block resolution
// ---------------------------------------------------------------------------

interface PartialConditional {
  tag: string;
  negated: boolean;
  active: boolean;
  startLine: number;
  lines: number[];
}

function isConditionalActive(
  tag: string,
  negated: boolean,
  filter: FlavorFilter,
): boolean {
  // `flavor: "all"` follows Curseforge-packager semantics: every conditional
  // block — whether for retail, vanilla, or an unknown tag — is treated as
  // active. The packager produces one build per flavor by inlining matching
  // blocks; our scanner aggregates the union.
  if (filter === "all") return true;

  const canonical = KNOWN_FLAVOR_ALIASES[tag.toLowerCase()];
  // Unknown tags are inactive under any specific filter (best-effort).
  if (canonical === undefined) return false;

  const matches = canonical === filter;
  return negated ? !matches : matches;
}

// ---------------------------------------------------------------------------
// Line-shape helpers
// ---------------------------------------------------------------------------

const DIRECTIVE_PATTERN = /^##\s*([^:]+?)\s*:\s*(.*?)\s*$/;
const CONDITIONAL_OPEN_PATTERN = /^#@(non-)?([A-Za-z][A-Za-z0-9_-]*)@\s*$/;
const CONDITIONAL_CLOSE_PATTERN =
  /^#@end-(non-)?([A-Za-z][A-Za-z0-9_-]*)@\s*$/;

function splitListValue(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Directive accumulator
// ---------------------------------------------------------------------------

interface DirectiveBuckets {
  readonly directives: TocDirective[];
  readonly xMetadata: Map<string, string>;
  savedVariables: string[];
  savedVariablesPerCharacter: string[];
  dependencies: string[];
  optionalDeps: string[];
  interfaceValue: string | null;
  title: string | null;
  version: string | null;
  author: string | null;
  notes: string | null;
}

function newBuckets(): DirectiveBuckets {
  return {
    directives: [],
    xMetadata: new Map(),
    savedVariables: [],
    savedVariablesPerCharacter: [],
    dependencies: [],
    optionalDeps: [],
    interfaceValue: null,
    title: null,
    version: null,
    author: null,
    notes: null,
  };
}

function ingestDirective(
  buckets: DirectiveBuckets,
  key: string,
  value: string,
  lineNumber: number,
): void {
  buckets.directives.push({ key, value, line: lineNumber });
  const lc = key.toLowerCase();

  if (lc.startsWith("x-")) {
    buckets.xMetadata.set(key.slice(2), value);
    return;
  }

  if (LIST_DIRECTIVES.has(lc)) {
    const list = splitListValue(value);
    if (lc === "savedvariables") buckets.savedVariables.push(...list);
    else if (lc === "savedvariablespercharacter")
      buckets.savedVariablesPerCharacter.push(...list);
    else if (lc === "dependencies" || lc === "requireddeps")
      buckets.dependencies.push(...list);
    else if (lc === "optionaldeps") buckets.optionalDeps.push(...list);
    return;
  }

  // Identity directives: ignore any locale-specific suffix (`Title-deDE` →
  // `Title`). The locale-tagged values are still in `directives[]`.
  const baseKey = lc.replace(/-[a-z]{2}[a-z]{2}$/i, "");
  if (baseKey === "interface" && buckets.interfaceValue === null)
    buckets.interfaceValue = value;
  else if (baseKey === "title" && buckets.title === null) buckets.title = value;
  else if (baseKey === "version" && buckets.version === null)
    buckets.version = value;
  else if (baseKey === "author" && buckets.author === null)
    buckets.author = value;
  else if (baseKey === "notes" && buckets.notes === null) buckets.notes = value;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse the contents of a TOC file. `flavorFilter` controls which
 * conditional blocks count as active and therefore whether file refs
 * inside them are emitted into `fileRefs`. Conditional blocks themselves
 * are always recorded in `conditionals` regardless of the filter.
 */
export function parseToc(
  source: string,
  absolutePath: string,
  flavorFilter: FlavorFilter,
): ParsedToc {
  const lines = source.split(/\r?\n/);
  const buckets = newBuckets();
  const fileRefs: TocFileRef[] = [];
  const conditionals: TocConditional[] = [];
  const parseWarnings: string[] = [];

  let openBlock: PartialConditional | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;

    // Directive (must precede the generic `#` comment check — directives
    // also start with `#`).
    if (trimmed.startsWith("##")) {
      const m = DIRECTIVE_PATTERN.exec(trimmed);
      if (!m) {
        parseWarnings.push(`Line ${lineNumber}: malformed directive`);
        continue;
      }
      ingestDirective(buckets, m[1], m[2], lineNumber);
      continue;
    }

    // Conditional block boundary
    if (trimmed.startsWith("#@")) {
      const close = CONDITIONAL_CLOSE_PATTERN.exec(trimmed);
      if (close) {
        if (openBlock === null) {
          parseWarnings.push(
            `Line ${lineNumber}: stray conditional close (no matching open)`,
          );
          continue;
        }
        conditionals.push({
          tag: openBlock.tag,
          negated: openBlock.negated,
          active: openBlock.active,
          lines: openBlock.lines,
        });
        openBlock = null;
        continue;
      }
      const open = CONDITIONAL_OPEN_PATTERN.exec(trimmed);
      if (open) {
        if (openBlock !== null) {
          parseWarnings.push(
            `Line ${lineNumber}: nested conditional blocks are not supported; previous block left open`,
          );
        }
        const negated = open[1] === "non-";
        const tag = open[2];
        openBlock = {
          tag,
          negated,
          active: isConditionalActive(tag, negated, flavorFilter),
          startLine: lineNumber,
          lines: [],
        };
        continue;
      }
      parseWarnings.push(`Line ${lineNumber}: unrecognised \`#@\` directive`);
      continue;
    }

    // Plain `#` comment (single-hash). Skip silently.
    if (trimmed.startsWith("#")) continue;

    // File reference. Tracked even when inside an inactive conditional, but
    // suppressed from the active `fileRefs` output below.
    if (openBlock !== null) {
      openBlock.lines.push(lineNumber);
      if (!openBlock.active) continue;
    }

    fileRefs.push({
      path: trimmed,
      line: lineNumber,
      conditional: openBlock
        ? {
            tag: openBlock.tag,
            negated: openBlock.negated,
            active: openBlock.active,
            lines: [], // populated only on close; per-ref view is unhelpful
          }
        : null,
    });
  }

  if (openBlock !== null) {
    parseWarnings.push(
      `Line ${openBlock.startLine}: conditional block opened but never closed`,
    );
    conditionals.push({
      tag: openBlock.tag,
      negated: openBlock.negated,
      active: openBlock.active,
      lines: openBlock.lines,
    });
  }

  return {
    path: absolutePath,
    flavor: detectTocFlavor(path.basename(absolutePath)),
    directives: buckets.directives,
    fileRefs,
    savedVariables: buckets.savedVariables,
    savedVariablesPerCharacter: buckets.savedVariablesPerCharacter,
    dependencies: buckets.dependencies,
    optionalDeps: buckets.optionalDeps,
    interface: buckets.interfaceValue,
    title: buckets.title,
    version: buckets.version,
    author: buckets.author,
    notes: buckets.notes,
    conditionals,
    xMetadata: buckets.xMetadata,
    parseWarnings,
  };
}
