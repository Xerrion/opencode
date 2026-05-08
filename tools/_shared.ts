// tools/_shared.ts

import { readdirSync, type Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
//
// Shared report builder for all wow-* tools.
//
// The schema is fixed across every tool:
//
//   # <Constant Tool Title>
//
//   **Query:** `<value>`
//   [**<Key>:** <value>] ...        ← contiguous metadata block, no blank lines
//
//   ## <Outcome>                    ← exactly one of: Result, No Match, Error
//
//   <body>
//
//   [## Notes                       ← optional, last; only emitted when present
//   <notes>]
//
// This module owns the schema. Tools own only their tool-specific Result body
// content (rg dumps, H3 sections, tables, per-finding blocks). The builder
// passes Result bodies through verbatim; it structures No-Match and Error
// shapes completely.

export const TITLES = {
  apiLookup: "WoW API Annotations",
  eventInfo: "WoW Event Lookup",
  wikiFetch: "WoW Wiki Page",
  blizzardSource: "Blizzard FrameXML Source",
  addonLint: "WoW Addon Lint Report",
  localeCheck: "WoW Addon Locale Check",
  projectScan: "WoW Addon Project Scan",
  savedVars: "WoW SavedVariables Inspection",
  compatCheck: "WoW Addon Compatibility Check",
  mixinResolver: "WoW Mixin & Template Resolver",
} as const;

export type ToolTitle = (typeof TITLES)[keyof typeof TITLES];

export type MetadataPair = readonly [key: string, value: string];

export type Suggestions = readonly [string, ...string[]];

export type ReportBody =
  | { readonly outcome: "result"; readonly body: string }
  | {
      readonly outcome: "no-match";
      readonly paragraph: string;
      readonly suggestions: Suggestions;
    }
  | {
      readonly outcome: "error";
      readonly reason: string;
      readonly cause: string;
      readonly suggestions: Suggestions;
    };

export interface ReportSpec {
  readonly title: ToolTitle;
  readonly metadata: readonly MetadataPair[];
  readonly body: ReportBody;
  readonly notes?: string;
}

export interface ErrorSpec {
  readonly title: ToolTitle;
  readonly metadata: readonly MetadataPair[];
  readonly reason: string;
  readonly cause: string;
  readonly suggestions: Suggestions;
}

export interface NoMatchSpec {
  readonly title: ToolTitle;
  readonly metadata: readonly MetadataPair[];
  readonly paragraph: string;
  readonly suggestions: Suggestions;
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateSpec(spec: ReportSpec): void {
  for (const [key, value] of spec.metadata) {
    if (key.includes(":") || key.includes("\n")) {
      throw new Error(
        `Invalid metadata key ${JSON.stringify(key)}: must not contain ':' or newline.`,
      );
    }
    if (value.includes("\n")) {
      throw new Error(
        `Invalid metadata value for key ${JSON.stringify(key)}: must not contain newline.`,
      );
    }
  }

  if (
    spec.body.outcome === "result" &&
    spec.body.body.trimStart().startsWith("## ")
  ) {
    throw new Error(
      "Result body must not start with an H2 heading; the builder emits the `## Result` discriminator.",
    );
  }
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildHeader(
  title: ToolTitle,
  metadata: readonly MetadataPair[],
): string {
  if (metadata.length === 0) return `# ${title}`;
  const metadataLines = metadata
    .map(([key, value]) => `**${key}:** ${value}`)
    .join("\n");
  return `# ${title}\n\n${metadataLines}`;
}

function bulletList(items: Suggestions): string {
  return items.map((s) => `- ${s}`).join("\n");
}

function buildBodySection(body: ReportBody): string {
  if (body.outcome === "result") {
    return `## Result\n\n${body.body}`;
  }
  if (body.outcome === "no-match") {
    return (
      `## No Match\n\n${body.paragraph}\n\n` +
      `### Suggestions\n\n${bulletList(body.suggestions)}`
    );
  }
  return (
    `## Error\n\n**Error:** ${body.reason}\n**Cause:** ${body.cause}\n\n` +
    `### Suggestions\n\n${bulletList(body.suggestions)}`
  );
}

function hasNotes(notes: string | undefined): notes is string {
  return notes !== undefined && notes.trim() !== "";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderReport(spec: ReportSpec): string {
  validateSpec(spec);

  const sections: string[] = [
    buildHeader(spec.title, spec.metadata),
    buildBodySection(spec.body),
  ];

  if (hasNotes(spec.notes)) {
    sections.push(`## Notes\n\n${spec.notes}`);
  }

  return sections.join("\n\n");
}

export function renderError(spec: ErrorSpec): string {
  return renderReport({
    title: spec.title,
    metadata: spec.metadata,
    body: {
      outcome: "error",
      reason: spec.reason,
      cause: spec.cause,
      suggestions: spec.suggestions,
    },
  });
}

export function renderNoMatch(spec: NoMatchSpec): string {
  return renderReport({
    title: spec.title,
    metadata: spec.metadata,
    body: {
      outcome: "no-match",
      paragraph: spec.paragraph,
      suggestions: spec.suggestions,
    },
    notes: spec.notes,
  });
}

// ---------------------------------------------------------------------------
// Filesystem constants
// ---------------------------------------------------------------------------

/**
 * Root directory of the locally-extracted WoW LuaLS annotations. Tools that
 * grep these files (`wow-api-lookup`, `wow-addon-lint`) share this path so
 * that an installation move only needs to be reflected here.
 */
export const WOW_ANNOTATIONS_ROOT = path.join(
  os.homedir(),
  ".local/share/wow-annotations/Annotations",
);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Strip a known absolute base prefix from an absolute path, returning the
 * relative remainder. If `absolutePath` does not start with `base` followed
 * by a path separator (or end exactly at `base`), returns `absolutePath`
 * unchanged - this prevents sibling-prefix collisions (e.g. base `/foo/bar`
 * vs path `/foo/barbaz/x`).
 *
 * Assumes `base` has no trailing separator (matches all current call sites
 * which use `path.join(...)` results).
 */
export function stripBasePath(base: string, absolutePath: string): string {
  if (!absolutePath.startsWith(base)) return absolutePath;
  if (absolutePath.length === base.length) return "";
  if (absolutePath[base.length] !== path.sep) return absolutePath;
  return absolutePath.slice(base.length + 1);
}

/**
 * Format a block of `rg` output (`<path>:<line>:<text>` per line) so each
 * filepath is displayed relative to `base`. Lines without a `:` are passed
 * through verbatim (e.g. `--` separators between match groups).
 */
export function formatRgLines(base: string, raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) return line;
      const filePart = line.slice(0, colonIdx);
      const rest = line.slice(colonIdx);
      return stripBasePath(base, filePart) + rest;
    })
    .join("\n");
}

/**
 * `readdirSync` wrapped to return `null` on any I/O failure (missing dir,
 * permission denied, ...). Lifted into a helper so callers can use a single
 * `const` binding and avoid the `let entries; try { entries = ... }` shape.
 */
export function safeReadDir(dir: string): Dirent[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/**
 * Invoke ripgrep with the given arguments and return trimmed stdout.
 *
 * Exit code 1 (no matches found) is treated as a successful run with empty
 * output, NOT an error - this matches rg's contract. Any exit code > 1
 * throws with the captured stderr for diagnosis.
 *
 * The `rg` binary is resolved via PATH. Caller is responsible for ensuring
 * ripgrep is installed.
 */
export async function runRg(args: readonly string[]): Promise<string> {
  const proc = Bun.spawn(["rg", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // rg exits 1 when no matches found - that's not an error
  if (exitCode > 1) {
    throw new Error(`ripgrep failed (exit ${exitCode}): ${stderr.trim()}`);
  }
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Wiki helpers
// ---------------------------------------------------------------------------

/**
 * Demote H2/H3 wiki headings by two levels so embedded wiki content sits
 * under a `### Wiki Documentation` sub-section without colliding with the
 * canonical schema's "first H2 is the discriminator" rule.
 */
export function demoteWikiHeadings(markdown: string): string {
  return markdown
    .replace(/^## /gm, "#### ")
    .replace(/^### /gm, "##### ");
}

/**
 * Strip HTML tags and decode common entities from a string. Block-level
 * closing tags (`</p>`, `</li>`, `</tr>`, `</div>`, `</h1-6>`) and `<br>`
 * are converted to newlines BEFORE tag stripping, so that block structure
 * survives. Then all remaining tags are removed and HTML entities
 * (`&lt; &gt; &amp; &quot; &#39; &nbsp;` plus numeric refs) are decoded.
 *
 * Used by tools that embed wiki HTML in markdown reports.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&#\d+;/g, "");
}
