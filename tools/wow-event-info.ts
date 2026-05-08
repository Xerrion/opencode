import { tool } from "@opencode-ai/plugin";
import os from "node:os";
import path from "node:path";
import {
  demoteWikiHeadings,
  renderError,
  renderNoMatch,
  renderReport,
  stripHtml,
  TITLES,
  type Suggestions,
} from "./_shared";
import { SCENARIOS, type Scenario } from "./data/event-sequences";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_LUA_PATH = path.join(
  os.homedir(),
  ".local/share/wow-annotations/Annotations/Core/Data/Event.lua",
);

const WIKI_BASE_URL = "https://warcraft.wiki.gg/wiki";

const EVENT_LINE_PATTERN = /^\|\s*"([A-Z0-9_]+)"(?:\s*#\s*`?([^`]*)`?)?$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EventEntry {
  name: string;
  payload: string;
}

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

let cachedEvents: Map<string, EventEntry> | null = null;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function parseEventLine(line: string): EventEntry | null {
  const trimmed = line.replace(/^---/, "").trim();
  const match = trimmed.match(EVENT_LINE_PATTERN);
  if (!match) return null;

  const name = match[1];
  const payload = match[2]?.trim() ?? "";
  return { name, payload };
}

function parseEventEntries(fileContent: string): Map<string, EventEntry> {
  const events = new Map<string, EventEntry>();

  for (const line of fileContent.split("\n")) {
    const entry = parseEventLine(line);
    if (entry) {
      events.set(entry.name, entry);
    }
  }

  return events;
}

function findExactMatch(
  events: Map<string, EventEntry>,
  query: string,
): EventEntry | null {
  return events.get(query) ?? null;
}

function findPrefixMatches(
  events: Map<string, EventEntry>,
  query: string,
): EventEntry[] {
  const matches: EventEntry[] = [];
  for (const [name, entry] of events) {
    if (name.startsWith(query)) {
      matches.push(entry);
    }
  }
  return matches;
}

function findSubstringMatches(
  events: Map<string, EventEntry>,
  query: string,
): EventEntry[] {
  const matches: EventEntry[] = [];
  for (const [name, entry] of events) {
    if (name.includes(query)) {
      matches.push(entry);
    }
  }
  return matches;
}

function findRelatedEvents(
  events: Map<string, EventEntry>,
  eventName: string,
): string[] {
  // Extract the prefix before the last underscore segment as the "group"
  const underscoreIdx = eventName.indexOf("_");
  if (underscoreIdx === -1) return [];

  const prefix = eventName.slice(0, underscoreIdx);
  const related: string[] = [];

  for (const name of events.keys()) {
    if (name !== eventName && name.startsWith(prefix + "_")) {
      related.push(name);
    }
  }

  return related;
}

function buildExactMatchBody(
  entry: EventEntry,
  relatedEvents: string[],
  wikiContent: string | null,
  wikiError: string | null,
): string {
  const wikiUrl = `${WIKI_BASE_URL}/${entry.name}`;
  const lines: string[] = [`**Payload:** ${entry.payload || "(none)"}`];

  if (relatedEvents.length > 0) {
    const list = relatedEvents.slice(0, 20).join(", ");
    const suffix =
      relatedEvents.length > 20 ? `, ... (${relatedEvents.length} total)` : "";
    lines.push("");
    lines.push(`**Related Events:** ${list}${suffix}`);
  }

  lines.push("");
  lines.push(`**Wiki:** ${wikiUrl}`);

  if (wikiContent) {
    lines.push("");
    lines.push("### Wiki Documentation");
    lines.push("");
    lines.push(wikiContent);
  } else if (wikiError) {
    lines.push("");
    lines.push("### Wiki Documentation");
    lines.push("");
    lines.push(`(wiki fetch failed: ${wikiError})`);
  }

  return lines.join("\n");
}

function buildMultiMatchBody(matches: EventEntry[]): string {
  const rows = matches
    .map((entry) => `| ${entry.name} | ${entry.payload || "(none)"} |`)
    .join("\n");
  return (
    `Found ${matches.length} event${matches.length === 1 ? "" : "s"}:\n\n` +
    `| Event | Payload |\n` +
    `|-------|--------|\n` +
    rows
  );
}

function formatExactMatch(
  query: string,
  entry: EventEntry,
  relatedEvents: string[],
  wikiContent: string | null,
  wikiError: string | null,
): string {
  return renderReport({
    title: TITLES.eventInfo,
    metadata: [
      ["Query", `\`${query}\``],
      ["Match", "exact"],
      ["Event", entry.name],
    ],
    body: {
      outcome: "result",
      body: buildExactMatchBody(entry, relatedEvents, wikiContent, wikiError),
    },
  });
}

function formatMultipleMatches(
  query: string,
  matches: EventEntry[],
  matchType: "prefix" | "substring",
): string {
  return renderReport({
    title: TITLES.eventInfo,
    metadata: [
      ["Query", `\`${query}\``],
      ["Match", matchType],
    ],
    body: { outcome: "result", body: buildMultiMatchBody(matches) },
  });
}

function formatNoMatch(query: string, totalEvents: number): string {
  return renderNoMatch({
    title: TITLES.eventInfo,
    metadata: [
      ["Query", `\`${query}\``],
      ["Match", "none"],
    ],
    paragraph: `No events matched the query \`${query}\` (searched ${totalEvents} known events via exact, prefix, and substring match).`,
    suggestions: [
      "Check spelling (event names are UPPER_SNAKE_CASE)",
      'Try a broader term (e.g. "LOOT" instead of "LOOT_OPENED")',
      'Try a different keyword (e.g. "BAG" for bag-related events)',
    ],
  });
}

function formatEventError(
  query: string,
  reason: string,
  cause: string,
  suggestions: readonly [string, ...string[]],
): string {
  return renderError({
    title: TITLES.eventInfo,
    metadata: [["Query", `\`${query}\``]],
    reason,
    cause,
    suggestions,
  });
}

// ---------------------------------------------------------------------------
// Wiki fetcher
// ---------------------------------------------------------------------------

function extractWikiContent(html: string): string {
  // Extract the main content area between mw-parser-output div
  const parserOutputMatch = html.match(
    /<div class="mw-parser-output">([\s\S]*?)(?:<div class="printfooter"|<div id="catlinks")/,
  );
  if (!parserOutputMatch) return "(Could not extract wiki content)";

  let content = parserOutputMatch[1];

  // Remove navigation boxes, edit links, table of contents
  content = content.replace(/<div[^>]*class="[^"]*toc[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g, "");
  content = content.replace(/<span class="mw-editsection">[\s\S]*?<\/span>/g, "");
  content = content.replace(/<table[^>]*class="[^"]*navbox[^"]*"[\s\S]*?<\/table>/g, "");
  content = content.replace(/<div[^>]*class="[^"]*navbox[^"]*"[\s\S]*?<\/div>/g, "");

  // Convert headers to markdown
  content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, (_m, inner) => `\n## ${stripHtml(inner).trim()}\n`);
  content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/g, (_m, inner) => `\n### ${stripHtml(inner).trim()}\n`);
  content = content.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/g, (_m, inner) => `\n#### ${stripHtml(inner).trim()}\n`);

  // Convert code blocks
  content = content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, (_m, inner) => `\n\`\`\`lua\n${stripHtml(inner).trim()}\n\`\`\`\n`);
  content = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/g, (_m, inner) => `\`${stripHtml(inner)}\``);

  // Convert list items
  content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_m, inner) => `- ${stripHtml(inner).trim()}\n`);

  // Convert paragraphs
  content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (_m, inner) => `${stripHtml(inner).trim()}\n\n`);

  // Strip remaining HTML tags
  content = stripHtml(content);

  // Clean up excessive whitespace
  content = content.replace(/\n{3,}/g, "\n\n").trim();

  // Demote any H2/H3 from the wiki page so they sit BELOW the
  // `### Wiki Documentation` sub-section we embed them under, preserving
  // the canonical schema's "first H2 is the discriminator" rule.
  content = demoteWikiHeadings(content);

  // Truncate if extremely long
  const maxLength = 4000;
  if (content.length > maxLength) {
    content = content.slice(0, maxLength) + "\n\n... (truncated, see wiki page for full content)";
  }

  return content;
}

async function fetchWikiPage(
  eventName: string,
): Promise<{ content: string | null; error: string | null }> {
  const url = `${WIKI_BASE_URL}/${eventName}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        return { content: null, error: "no wiki page found for this event" };
      }
      return { content: null, error: `HTTP ${response.status}` };
    }
    const html = await response.text();
    return { content: extractWikiContent(html), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: null, error: message };
  }
}

// ---------------------------------------------------------------------------
// Event data loader
// ---------------------------------------------------------------------------

async function loadEvents(): Promise<Map<string, EventEntry>> {
  if (cachedEvents) return cachedEvents;

  const file = Bun.file(EVENT_LUA_PATH);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(
      "Event.lua annotation source not available; verify wow-annotations are installed.",
    );
  }

  const content = await file.text();
  cachedEvents = parseEventEntries(content);
  return cachedEvents;
}

// ---------------------------------------------------------------------------
// Sequence mode
// ---------------------------------------------------------------------------

function findScenarioExact(query: string): Scenario | null {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return null;
  for (const scenario of SCENARIOS) {
    if (scenario.key.toLowerCase() === normalized) return scenario;
    if (scenario.keywords.some((k) => k.toLowerCase() === normalized)) {
      return scenario;
    }
  }
  return null;
}

function findScenarioSubstring(query: string): readonly Scenario[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return [];
  return SCENARIOS.filter((scenario) => {
    const corpus = [scenario.key, ...scenario.keywords]
      .join(" ")
      .toLowerCase();
    return corpus.includes(normalized);
  });
}

function buildSequenceList(
  scenario: Scenario,
  events: Map<string, EventEntry>,
): { body: string; missing: readonly string[] } {
  const missing: string[] = [];
  const lines = scenario.events.map((event, idx) => {
    const entry = events.get(event.name);
    if (!entry) missing.push(event.name);
    const payload = entry?.payload || "(none)";
    const noteLine = event.note ? `\n   > ${event.note}` : "";
    return (
      `${idx + 1}. **${event.name}** — ${event.when}\n` +
      `   Payload: \`${payload}\`` +
      noteLine
    );
  });
  return { body: lines.join("\n\n"), missing };
}

function buildSeeAlsoSection(seeAlso: readonly string[]): string {
  const lines = seeAlso.map((key) => {
    const target = SCENARIOS.find((s) => s.key === key);
    const title = target?.title ?? "(unknown scenario)";
    return `- \`${key}\` — ${title}`;
  });
  return `### See Also\n\n${lines.join("\n")}`;
}

function buildScenarioNotes(
  scenario: Scenario,
  missing: readonly string[],
): string | undefined {
  const parts: string[] = [];
  if (scenario.notes && scenario.notes.trim() !== "") {
    parts.push(scenario.notes);
  }
  for (const name of missing) {
    parts.push(
      `Dataset integrity warning: \`${name}\` is referenced by scenario \`${scenario.key}\` but was not found in Event.lua.`,
    );
  }
  return parts.length === 0 ? undefined : parts.join("\n\n");
}

function formatScenarioResult(
  query: string,
  scenario: Scenario,
  matchKind: "exact" | "substring",
  events: Map<string, EventEntry>,
): string {
  const { body: sequenceBody, missing } = buildSequenceList(scenario, events);

  const sections: string[] = [
    `**${scenario.title}**`,
    scenario.description,
    `### Event Sequence\n\n${sequenceBody}`,
  ];

  if (scenario.seeAlso && scenario.seeAlso.length > 0) {
    sections.push(buildSeeAlsoSection(scenario.seeAlso));
  }

  return renderReport({
    title: TITLES.eventInfo,
    metadata: [
      ["Mode", "sequence"],
      ["Query", `\`${query}\``],
      ["Match", matchKind],
      ["Scenario", scenario.key],
    ],
    body: { outcome: "result", body: sections.join("\n\n") },
    notes: buildScenarioNotes(scenario, missing),
  });
}

function formatScenarioAmbiguous(
  query: string,
  candidates: readonly Scenario[],
): string {
  const rows = candidates
    .map((s) => {
      const keywords = s.keywords.slice(0, 4).join(", ");
      return `| \`${s.key}\` | ${s.title} | ${keywords} |`;
    })
    .join("\n");
  const body =
    `Multiple scenarios match \`${query}\`. Refine your query or use the exact key:\n\n` +
    `| Key | Title | Keywords |\n|---|---|---|\n${rows}`;

  return renderReport({
    title: TITLES.eventInfo,
    metadata: [
      ["Mode", "sequence"],
      ["Query", `\`${query}\``],
      ["Match", "ambiguous"],
    ],
    body: { outcome: "result", body },
  });
}

function scenarioSuggestions(): Suggestions {
  // SCENARIOS is non-empty by construction (17 entries), so the cast to the
  // non-empty Suggestions tuple is safe. Asserted at startup by the compiler
  // because SCENARIOS is `readonly Scenario[]` with literal entries.
  const list = SCENARIOS.map((s) => `\`${s.key}\` — ${s.title}`);
  return list as unknown as Suggestions;
}

function formatScenarioNoMatch(query: string): string {
  return renderNoMatch({
    title: TITLES.eventInfo,
    metadata: [
      ["Mode", "sequence"],
      ["Query", `\`${query}\``],
      ["Match", "none"],
    ],
    paragraph: `No curated scenario matched \`${query}\`. Available scenarios:`,
    suggestions: scenarioSuggestions(),
  });
}

async function executeSequenceMode(query: string): Promise<string> {
  if (!query.trim()) {
    return formatEventError(
      "(empty)",
      "`query` must not be empty.",
      "(no query provided)",
      [
        "Pass a scenario key (e.g. `loot-opened`) or a keyword (e.g. `loot`, `combat`, `addon load`).",
        "Use `mode: \"lookup\"` if you want a raw event name lookup instead.",
      ],
    );
  }

  const events = await loadEventsSafe();
  if (events instanceof Error) {
    return formatEventError(
      query,
      "Failed to load event annotation data.",
      events.message,
      [
        "Verify wow-annotations are installed (run maintain-annotations.sh).",
        "Check that Event.lua exists in the annotation tree.",
      ],
    );
  }

  const exact = findScenarioExact(query);
  if (exact) return formatScenarioResult(query, exact, "exact", events);

  const substring = findScenarioSubstring(query);
  if (substring.length === 1) {
    return formatScenarioResult(query, substring[0], "substring", events);
  }
  if (substring.length > 1) {
    return formatScenarioAmbiguous(query, substring);
  }
  return formatScenarioNoMatch(query);
}

async function loadEventsSafe(): Promise<Map<string, EventEntry> | Error> {
  try {
    return await loadEvents();
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export default tool({
  description:
    "Look up WoW event names, payloads, and documentation. Two modes:\n\n" +
    "**`mode: \"lookup\"`** (default) — symbol-shaped lookup. Pass an event name (`PLAYER_LOGIN`), prefix (`COMBAT_LOG`), or substring. Returns payload, related events, and optional wiki content via `wiki: true`.\n\n" +
    "**`mode: \"sequence\"`** — scenario-shaped lookup. Pass a keyword (e.g. `loot`, `combat`, `addon load`). Returns the curated ordered event sequence for ~17 well-known addon-dev workflows, with payloads and \"use this one for X\" guidance.\n\n" +
    "Lookup mode searches the local `Event.lua` annotation file (FrameEvent definitions) using exact → prefix → substring fallback; event names are normalised to UPPER_SNAKE_CASE before searching. Sequence mode searches a curated dataset using exact (key or keyword) → substring fallback; multiple substring matches return an ambiguity table.\n\n" +
    "DO NOT use this for non-event API — use `wow-api-lookup`.",
  args: {
    query: tool.schema
      .string()
      .describe(
        'In `lookup` mode: an event name or partial match (UPPER_SNAKE_CASE), e.g. "LOOT_OPENED" (exact), "LOOT" (all LOOT_* events), "COMBAT" (substring). ' +
          'In `sequence` mode: a scenario key or natural-language keyword, e.g. "loot-opened", "loot", "combat", "addon load".',
      ),
    mode: tool.schema
      .enum(["lookup", "sequence"])
      .optional()
      .default("lookup")
      .describe(
        "Search mode. `lookup` (default) returns event signatures from local FrameEvent annotations. `sequence` returns the curated ordered event sequence for a well-known addon-dev workflow (loot window, combat enter/leave, addon load, etc.).",
      ),
    wiki: tool.schema
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Fetch wiki page for this event. Only meaningful in `mode: \"lookup\"` with an exact match; ignored otherwise (no error, just skipped). Adds an HTTP round-trip and embeds the wiki page body under the result.",
      ),
  },
  async execute(args) {
    const { query, wiki = false, mode = "lookup" } = args;

    if (mode === "sequence") {
      return await executeSequenceMode(query);
    }

    // Guard: empty query
    if (!query.trim()) {
      return formatEventError(
        "(empty)",
        "`query` must not be empty.",
        "(no query provided)",
        [
          "Pass an event name (UPPER_SNAKE_CASE) or a partial fragment.",
          "Example: `LOOT_OPENED`, `ADDON_LOADED`, `LOOT`, `COMBAT`.",
        ],
      );
    }

    // Parse at boundary: normalize to uppercase
    const normalizedQuery = query.trim().toUpperCase();

    // Load event data
    let events: Map<string, EventEntry>;
    try {
      events = await loadEvents();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return formatEventError(
        normalizedQuery,
        "Failed to load event annotation data.",
        message,
        [
          "Verify wow-annotations are installed (run maintain-annotations.sh).",
          "Check that Event.lua exists in the annotation tree.",
        ],
      );
    }

    // Step 1: Exact match
    const exactMatch = findExactMatch(events, normalizedQuery);
    if (exactMatch) {
      const relatedEvents = findRelatedEvents(events, exactMatch.name);
      const wikiResult = wiki
        ? await fetchWikiPage(exactMatch.name)
        : { content: null, error: null };
      return formatExactMatch(
        normalizedQuery,
        exactMatch,
        relatedEvents,
        wikiResult.content,
        wikiResult.error,
      );
    }

    // Step 2: Prefix match
    const prefixMatches = findPrefixMatches(events, normalizedQuery);
    if (prefixMatches.length > 0) {
      return formatMultipleMatches(normalizedQuery, prefixMatches, "prefix");
    }

    // Step 3: Substring match
    const substringMatches = findSubstringMatches(events, normalizedQuery);
    if (substringMatches.length > 0) {
      return formatMultipleMatches(
        normalizedQuery,
        substringMatches,
        "substring",
      );
    }

    // Nothing found
    return formatNoMatch(normalizedQuery, events.size);
  },
});
