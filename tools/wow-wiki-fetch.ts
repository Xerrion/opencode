import { tool } from "@opencode-ai/plugin";
import {
  renderError,
  renderReport,
  stripHtml,
  TITLES,
  type MetadataPair,
} from "./_shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WIKI_BASE = "https://warcraft.wiki.gg/wiki";

const QUERY_TYPES = ["auto", "function", "c_api", "event", "widget"] as const;
type QueryType = (typeof QUERY_TYPES)[number];

const MAX_CONTENT_LENGTH = 12_000;

// ---------------------------------------------------------------------------
// Query type detection
// ---------------------------------------------------------------------------

/** Common verb prefixes in WoW global API function names */
const FUNCTION_PREFIXES = [
  "Get",
  "Set",
  "Is",
  "Has",
  "Can",
  "Do",
  "Create",
  "Delete",
  "Remove",
  "Add",
  "Toggle",
  "Enable",
  "Disable",
  "Register",
  "Unregister",
  "Accept",
  "Decline",
  "Close",
  "Open",
  "Show",
  "Hide",
  "Start",
  "Stop",
  "Use",
  "Cast",
  "Equip",
  "Pickup",
  "Place",
  "Put",
  "Take",
  "Buy",
  "Sell",
  "Send",
  "Leave",
  "Join",
  "Invite",
  "Request",
  "Query",
  "Sort",
  "Clear",
  "Reset",
  "Load",
  "Save",
  "Run",
  "Log",
  "Unit",
  "Spell",
];

function looksLikeFunctionName(query: string): boolean {
  return FUNCTION_PREFIXES.some((prefix) => query.startsWith(prefix));
}

function detectQueryType(query: string): QueryType {
  if (query.includes("/") || query.startsWith("https://")) return "auto"; // raw path
  if (/^C_\w+\.\w+/.test(query)) return "c_api";
  if (/^[A-Z][A-Z0-9_]+$/.test(query) && query.includes("_")) return "event";
  if (/^[A-Z][a-zA-Z]+$/.test(query) && looksLikeFunctionName(query))
    return "function";
  if (/^[A-Z][a-zA-Z]+$/.test(query)) return "widget";
  return "function";
}

// ---------------------------------------------------------------------------
// URL construction - pure functions per type
// ---------------------------------------------------------------------------

function buildUrlForFunction(name: string): string {
  return `${WIKI_BASE}/API_${name}`;
}

function buildUrlForCApi(name: string): string {
  // C_LootHistory.GetLoot -> API_C_LootHistory.GetLoot (dot is literal)
  return `${WIKI_BASE}/API_${name}`;
}

function buildUrlForEvent(name: string): string {
  return `${WIKI_BASE}/${name}`;
}

function buildUrlForWidget(name: string): string {
  return `${WIKI_BASE}/UIOBJECT_${name}`;
}

function buildUrlForRawPath(query: string): string {
  if (query.startsWith("https://")) return query;
  // Treat as wiki path segment
  const cleanPath = query.startsWith("/") ? query.slice(1) : query;
  return `${WIKI_BASE}/${cleanPath}`;
}

function buildWikiUrl(query: string, resolvedType: QueryType): string {
  switch (resolvedType) {
    case "function":
      return buildUrlForFunction(query);
    case "c_api":
      return buildUrlForCApi(query);
    case "event":
      return buildUrlForEvent(query);
    case "widget":
      return buildUrlForWidget(query);
    default:
      return buildUrlForRawPath(query);
  }
}

function resolveQueryType(query: string, explicit: QueryType): QueryType {
  if (explicit !== "auto") return explicit;

  const detected = detectQueryType(query);
  // "auto" from detectQueryType means raw path - keep it
  return detected;
}

// ---------------------------------------------------------------------------
// HTML parsing helpers - no external dependencies
// ---------------------------------------------------------------------------

function extractMainContent(html: string): string {
  // MediaWiki stores content inside <div id="mw-content-text">...</div>
  // We grab from that div to the end, then strip a reasonable boundary
  const contentStart = html.indexOf('id="mw-content-text"');
  if (contentStart === -1) return "";

  const afterStart = html.indexOf(">", contentStart);
  if (afterStart === -1) return "";

  // Find the content region - stop before footer / navigation elements
  const contentHtml = html.slice(afterStart + 1);

  // Cut at common footer markers
  const footerMarkers = [
    'id="catlinks"',
    'class="printfooter"',
    'id="mw-navigation"',
    "<!--esi",
  ];

  let endIdx = contentHtml.length;
  for (const marker of footerMarkers) {
    const idx = contentHtml.indexOf(marker);
    if (idx !== -1 && idx < endIdx) {
      endIdx = idx;
    }
  }

  return contentHtml.slice(0, endIdx);
}

function extractSections(
  contentHtml: string,
): Map<string, string> {
  const sections = new Map<string, string>();

  // Split on heading tags to find sections
  // MediaWiki uses <h2><span id="SectionName">...</span></h2> or similar
  const headingPattern =
    /<h([2-3])[^>]*>.*?<span[^>]*id="([^"]*)"[^>]*>.*?<\/span>.*?<\/h\1>/gi;

  const headings: Array<{ name: string; index: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(contentHtml)) !== null) {
    headings.push({ name: match[2], index: match.index });
  }

  // Also try simpler heading pattern without span ids
  if (headings.length === 0) {
    const simpleHeadingPattern = /<h([2-3])[^>]*>(.*?)<\/h\1>/gi;
    while ((match = simpleHeadingPattern.exec(contentHtml)) !== null) {
      const name = stripHtml(match[2]).trim();
      if (name) {
        headings.push({ name, index: match.index });
      }
    }
  }

  // Extract description (everything before first heading)
  if (headings.length > 0) {
    const descriptionHtml = contentHtml.slice(0, headings[0].index);
    const descriptionText = stripHtml(descriptionHtml).trim();
    if (descriptionText) {
      sections.set("Description", descriptionText);
    }
  } else {
    // No headings found - entire content is description
    const descriptionText = stripHtml(contentHtml).trim();
    if (descriptionText) {
      sections.set("Description", descriptionText);
    }
    return sections;
  }

  // Extract each heading section
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextStart =
      i + 1 < headings.length ? headings[i + 1].index : contentHtml.length;
    const sectionHtml = contentHtml.slice(heading.index, nextStart);
    const sectionText = stripHtml(sectionHtml).trim();

    // Remove the heading text itself from the section body
    const headingText = heading.name.replace(/_/g, " ");
    const bodyText = sectionText
      .replace(new RegExp(`^\\s*${escapeRegex(headingText)}\\s*`, "i"), "")
      .trim();

    if (bodyText) {
      sections.set(normalizeHeadingName(heading.name), bodyText);
    }
  }

  return sections;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeHeadingName(raw: string): string {
  // Wiki section IDs use underscores: "Patch_changes" -> "Patch changes"
  return raw.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Signature extraction - structured block for API/event/widget-method pages
// ---------------------------------------------------------------------------

type SignatureParam = {
  name: string;
  type: string;
  nilable: boolean;
  description: string;
};

type SignatureBlock = {
  signatureLines: string[];
  parameters: SignatureParam[];
  returns: SignatureParam[];
  payload: SignatureParam[] | "none" | null;
};

/**
 * Parse the `class` attribute of a tag's attribute string into a token list.
 * Returns an empty array if no `class` attribute is present. Supports both
 * double- and single-quoted forms.
 */
function parseClassTokens(tagAttrs: string): string[] {
  const match =
    /\bclass\s*=\s*"([^"]*)"/i.exec(tagAttrs) ??
    /\bclass\s*=\s*'([^']*)'/i.exec(tagAttrs);
  if (!match) return [];
  return match[1].split(/\s+/).filter((token) => token.length > 0);
}

/**
 * The wiki marks the canonical signature with a `<div>` wrapping a
 * Pygments-tokenised `<pre>`. The discriminator is the `class` attribute
 * (parsed as a token list): it MUST contain both `mw-highlight` and
 * `mw-highlight-lang-lua`, and MUST NOT contain `mw-highlight-copy` (that
 * marker tags the inline copy-button block). A multi-line `<pre>` represents
 * overloads (e.g. `UnitClass`).
 */
function isCanonicalSignatureDiv(tagAttrs: string): boolean {
  const classes = parseClassTokens(tagAttrs);
  return (
    classes.includes("mw-highlight") &&
    classes.includes("mw-highlight-lang-lua") &&
    !classes.includes("mw-highlight-copy")
  );
}

function extractSignatureLines(contentHtml: string): string[] | null {
  const divPattern =
    /<div\b([^>]*)>\s*<pre\b[^>]*>([\s\S]*?)<\/pre>\s*<\/div>/gi;
  let match: RegExpExecArray | null;
  while ((match = divPattern.exec(contentHtml)) !== null) {
    if (!isCanonicalSignatureDiv(match[1])) continue;
    const lines = stripHtml(match[2])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) return null;
    return lines;
  }
  return null;
}

/** Capture the HTML between an `<h2 id="anchor">` and the next `<h2>` (or EOF). */
function extractSectionByAnchor(
  contentHtml: string,
  anchorId: string,
): string | null {
  const headingPattern = new RegExp(
    `<h2\\b[^>]*>[\\s\\S]*?\\bid="${escapeRegex(anchorId)}"[\\s\\S]*?<\\/h2>`,
    "i",
  );
  const headingMatch = headingPattern.exec(contentHtml);
  if (!headingMatch) return null;
  const startIdx = headingMatch.index + headingMatch[0].length;
  const tail = contentHtml.slice(startIdx);
  const nextH2 = tail.search(/<h2\b/i);
  return nextH2 === -1 ? tail : tail.slice(0, nextH2);
}

/**
 * Within an Arguments/Returns/Payload section the wiki uses a `<dt>NAME</dt>`
 * + `<dd>TYPE [- description]</dd>` skeleton. We trust the first
 * type-coloured span as the canonical type and detect nilability from the
 * `title="nilable"` marker.
 *
 * Implementation note: we split on `<dt` boundaries and parse each chunk
 * independently. If one chunk has malformed nesting (e.g. an unclosed inner
 * tag), the failure stays localised to that single param rather than
 * derailing the whole regex sweep.
 */
function extractParamsFromSection(sectionHtml: string): SignatureParam[] {
  const params: SignatureParam[] = [];
  // First chunk is preamble before any <dt>; skip it.
  const chunks = sectionHtml.split(/<dt\b/i).slice(1);

  for (const rawChunk of chunks) {
    // rawChunk starts immediately after `<dt` - i.e. with the rest of the
    // <dt> opening tag (attributes + `>`), then dt content, then </dt>, then
    // optional whitespace, then the matching <dd>...</dd>.
    const dtOpenClose = rawChunk.indexOf(">");
    if (dtOpenClose === -1) continue;
    const dtEnd = rawChunk.indexOf("</dt>", dtOpenClose);
    if (dtEnd === -1) continue;

    const dtInner = rawChunk.slice(dtOpenClose + 1, dtEnd);
    const name = stripHtml(dtInner).trim();
    if (!name) continue;

    const afterDt = rawChunk.slice(dtEnd + "</dt>".length);
    const ddMatch = /^\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/i.exec(afterDt);
    if (!ddMatch) continue;
    const ddHtml = ddMatch[1];

    const typeMatch = ddHtml.match(
      /<span[^>]*color:\s*#ecbc2a[^>]*>([\s\S]*?)<\/span>/i,
    );
    const type = typeMatch ? stripHtml(typeMatch[1]).trim() : "unknown";
    const nilable = /title="nilable"/i.test(ddHtml);

    const ddText = stripHtml(ddHtml).trim();
    const sepIdx = ddText.indexOf(" - ");
    const description = sepIdx === -1 ? "" : ddText.slice(sepIdx + 3).trim();

    params.push({ name, type, nilable, description });
  }
  return params;
}

function extractSignature(contentHtml: string): SignatureBlock | null {
  try {
    const signatureLines = extractSignatureLines(contentHtml);
    if (!signatureLines) return null;

    const argsHtml = extractSectionByAnchor(contentHtml, "Arguments");
    const returnsHtml = extractSectionByAnchor(contentHtml, "Returns");
    const payloadHtml = extractSectionByAnchor(contentHtml, "Payload");

    const parameters = argsHtml ? extractParamsFromSection(argsHtml) : [];
    const returns = returnsHtml ? extractParamsFromSection(returnsHtml) : [];

    let payload: SignatureParam[] | "none" | null;
    if (payloadHtml === null) {
      payload = null;
    } else {
      const payloadText = stripHtml(payloadHtml).trim();
      payload =
        payloadText === "None" ? "none" : extractParamsFromSection(payloadHtml);
    }

    return { signatureLines, parameters, returns, payload };
  } catch {
    return null;
  }
}

function formatParamList(params: readonly SignatureParam[]): string {
  return params
    .map((param) => {
      const typeText = param.nilable
        ? `\`${param.type}\`, nilable`
        : `\`${param.type}\``;
      const descSuffix = param.description ? ` — ${param.description}` : "";
      return `- **\`${param.name}\`** (${typeText})${descSuffix}`;
    })
    .join("\n");
}

function formatSignatureBlock(block: SignatureBlock): string {
  const parts: string[] = [];
  parts.push("```lua\n" + block.signatureLines.join("\n") + "\n```");

  if (block.parameters.length > 0) {
    parts.push(`**Parameters:**\n\n${formatParamList(block.parameters)}`);
  }
  if (block.returns.length > 0) {
    parts.push(`**Returns:**\n\n${formatParamList(block.returns)}`);
  }
  if (block.payload === "none") {
    parts.push("**Payload:**\n\n- (none)");
  } else if (Array.isArray(block.payload) && block.payload.length > 0) {
    parts.push(`**Payload:**\n\n${formatParamList(block.payload)}`);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Section selection - pick the most useful sections for output
// ---------------------------------------------------------------------------

const DESIRED_SECTIONS = [
  "Description",
  "Parameters",
  "Arguments",
  "Returns",
  "Return values",
  "Return value",
  "Details",
  "Notes",
  "Example",
  "Examples",
  "Usage",
  "Triggers",
  "Payload",
  "Fields",
  "Methods",
  "Patch changes",
];

function selectRelevantSections(
  allSections: Map<string, string>,
): Map<string, string> {
  const selected = new Map<string, string>();

  for (const desired of DESIRED_SECTIONS) {
    const key = findSectionKey(allSections, desired);
    if (key) {
      selected.set(desired, allSections.get(key)!);
    }
  }

  // If we got very little, include everything we have
  if (selected.size <= 1) {
    return allSections;
  }

  return selected;
}

function findSectionKey(
  sections: Map<string, string>,
  target: string,
): string | undefined {
  const targetLower = target.toLowerCase();
  for (const key of sections.keys()) {
    if (key.toLowerCase() === targetLower) return key;
  }
  // Partial match fallback
  for (const key of sections.keys()) {
    if (key.toLowerCase().includes(targetLower)) return key;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function buildWikiMetadata(
  query: string,
  type: string,
  url: string,
): MetadataPair[] {
  return [
    ["Query", `\`${query}\``],
    ["Type", type],
    ["Source", url],
  ];
}

function resolveTypeLabel(query: string, resolvedType: QueryType): string {
  // Distinguish raw paths/URLs from auto-detected types in the metadata
  if (query.includes("/") || query.startsWith("https://")) return "path";
  return resolvedType;
}

function formatOutput(
  query: string,
  url: string,
  resolvedType: QueryType,
  sections: Map<string, string>,
  signatureMarkdown: string | null,
): string {
  const sectionBlocks: string[] = [];
  if (signatureMarkdown) {
    sectionBlocks.push(`### Signature\n\n${signatureMarkdown}`);
  }
  for (const [heading, body] of sections) {
    sectionBlocks.push(`### ${heading}\n\n${truncateSection(body)}`);
  }
  return renderReport({
    title: TITLES.wikiFetch,
    metadata: buildWikiMetadata(
      query,
      resolveTypeLabel(query, resolvedType),
      url,
    ),
    body: { outcome: "result", body: sectionBlocks.join("\n\n") },
  });
}

function truncateSection(text: string): string {
  // Collapse excessive whitespace
  const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length <= MAX_CONTENT_LENGTH) return cleaned;
  return (
    cleaned.slice(0, MAX_CONTENT_LENGTH) +
    "\n\n... (truncated - view full page on wiki)"
  );
}

function buildFetchErrorReport(
  query: string,
  url: string,
  status: number,
  resolvedType: QueryType,
): string {
  const reason =
    status === 0
      ? "Network or server error fetching the wiki."
      : `HTTP ${status} fetching ${url}.`;
  const cause =
    status === 404
      ? `Page \`${url}\` does not exist on the wiki.`
      : status === 0
        ? "Unreachable host or DNS failure."
        : `Wiki responded with HTTP ${status}.`;

  const suggestions: string[] = [];

  if (status === 404) {
    if (resolvedType === "widget") {
      suggestions.push(
        `Try the function URL instead: ${buildUrlForFunction(query)}`,
      );
    }
    if (resolvedType === "function") {
      suggestions.push(
        `Try the widget URL instead: ${buildUrlForWidget(query)}`,
      );
    }
    suggestions.push(
      `Search the wiki directly: https://warcraft.wiki.gg/index.php?search=${encodeURIComponent(query)}`,
    );
    suggestions.push(
      "Use the `wow-api-lookup` tool for local annotation signatures.",
    );
  } else {
    suggestions.push("Retry in a moment - the wiki may be temporarily unavailable.");
    suggestions.push(`Check the URL manually: ${url}`);
  }

  // Suggestions is non-empty by construction (always at least 2 pushes for
  // 404 widget/function/search, and 2 pushes for non-404).
  const [first, ...rest] = suggestions;
  return renderError({
    title: TITLES.wikiFetch,
    metadata: buildWikiMetadata(
      query,
      resolveTypeLabel(query, resolvedType),
      url,
    ),
    reason,
    cause,
    suggestions: [first, ...rest] as readonly [string, ...string[]],
  });
}

// ---------------------------------------------------------------------------
// Fetch with redirect/retry logic
// ---------------------------------------------------------------------------

async function fetchWikiPage(
  url: string,
): Promise<{ ok: boolean; status: number; html: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "opencode-wow-wiki-fetch/1.0",
        Accept: "text/html",
      },
      redirect: "follow",
    });

    const html = await response.text();
    return { ok: response.ok, status: response.status, html };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown fetch error";
    return { ok: false, status: 0, html: message };
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export default tool({
  description:
    "Fetch detailed documentation from warcraft.wiki.gg for any WoW API function, event, widget, or topic. Returns behavioural details, caveats, parameters, return values, and examples that local annotation files do not carry.\n\n" +
    "Usage:\n" +
    "- The query name is mapped to a wiki URL by auto-detection:\n" +
    "  - `C_*` (e.g. `C_Item.GetItemInfo`) → CAPI URL (`API_C_X.Y`).\n" +
    "  - `ALL_CAPS` with underscores (e.g. `LOOT_OPENED`) → event URL (`EVENT_NAME`).\n" +
    "  - `PascalCase` without verb prefix (e.g. `Frame`, `StatusBar`) → widget URL (`UIOBJECT_X`).\n" +
    "  - Otherwise (e.g. `GetLootSlotInfo`) → global function URL (`API_X`).\n" +
    "- Pass `type` to override the auto-detected pattern explicitly.\n" +
    "- Raw paths (containing `/`) and full URLs are accepted as-is.\n\n" +
    "For events, prefer `wow-event-info` with `wiki: true` (it pre-resolves the canonical event URL and merges with local payload data).\n" +
    "For documented C_ API signatures, prefer `wow-api-lookup` (local search, faster).",
  args: {
    query: tool.schema
      .string()
      .describe(
        'The API name, event name, widget type, or wiki path to look up. Examples: "GetLootSlotInfo", "C_Item.GetItemInfo", "LOOT_OPENED", "Frame", "Professions/Recipes"',
      ),
    type: tool.schema
      .enum(["auto", "function", "c_api", "event", "widget"])
      .optional()
      .default("auto")
      .describe(
        'Force a specific URL pattern instead of auto-detection. "auto" infers from the query shape. ' +
          'Use "function" for API_X, "c_api" for API_C_X.Y, "event" for EVENT_NAME, "widget" for UIOBJECT_X.',
      ),
  },
  async execute(args) {
    const { query, type = "auto" } = args;

    // --- Guard clauses ---
    if (!query.trim()) {
      return renderError({
        title: TITLES.wikiFetch,
        metadata: [["Query", "`(empty)`"]],
        reason: "`query` must not be empty.",
        cause: "(no query provided)",
        suggestions: [
          "Pass an API name, event, widget, or wiki path.",
          "Examples: `GetLootSlotInfo`, `C_Item.GetItemInfo`, `LOOT_OPENED`, `Frame`, `Professions/Recipes`.",
        ],
      });
    }

    // --- Parse query type at boundary ---
    const trimmedQuery = query.trim();
    const resolvedType = resolveQueryType(trimmedQuery, type);
    const url = buildWikiUrl(trimmedQuery, resolvedType);

    // --- Fetch ---
    const { ok, status, html } = await fetchWikiPage(url);

    if (!ok) {
      return buildFetchErrorReport(trimmedQuery, url, status, resolvedType);
    }

    // --- Parse HTML into sections ---
    const contentHtml = extractMainContent(html);
    const typeLabel = resolveTypeLabel(trimmedQuery, resolvedType);

    if (!contentHtml) {
      return renderReport({
        title: TITLES.wikiFetch,
        metadata: buildWikiMetadata(trimmedQuery, typeLabel, url),
        body: {
          outcome: "result",
          body:
            `### Content\n\n` +
            `Page fetched successfully but content extraction failed - the page structure may be non-standard. ` +
            `Visit the page directly: ${url}`,
        },
      });
    }

    const allSections = extractSections(contentHtml);

    if (allSections.size === 0) {
      // Fallback: return raw stripped text
      const rawText = stripHtml(contentHtml).trim();
      if (!rawText) {
        return renderReport({
          title: TITLES.wikiFetch,
          metadata: buildWikiMetadata(trimmedQuery, typeLabel, url),
          body: {
            outcome: "result",
            body: `### Content\n\nPage appears to have no text content. Visit: ${url}`,
          },
        });
      }

      return renderReport({
        title: TITLES.wikiFetch,
        metadata: buildWikiMetadata(trimmedQuery, typeLabel, url),
        body: {
          outcome: "result",
          body: `### Content\n\n${truncateSection(rawText)}`,
        },
      });
    }

    const relevantSections = selectRelevantSections(allSections);
    const signatureBlock = extractSignature(contentHtml);
    const signatureMarkdown = signatureBlock
      ? formatSignatureBlock(signatureBlock) || null
      : null;
    return formatOutput(
      trimmedQuery,
      url,
      resolvedType,
      relevantSections,
      signatureMarkdown,
    );
  },
});
