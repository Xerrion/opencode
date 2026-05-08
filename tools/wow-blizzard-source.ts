import { tool } from "@opencode-ai/plugin";
import os from "node:os";
import path from "node:path";
import { readdirSync, existsSync, statSync } from "node:fs";
import {
  formatRgLines,
  renderError,
  renderNoMatch,
  renderReport,
  runRg,
  stripBasePath,
  TITLES,
  type MetadataPair,
} from "./_shared";

const LEGACY_FRAMEXML_BASE = path.join(
  os.homedir(),
  ".local/share/wow-annotations/Annotations/FrameXML/Annotations",
);

const FRAMEXML_DIR = path.join(
  os.homedir(),
  ".local/share/wow-framexml",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the FrameXML base directory for a given WoW version.
 *
 * - Explicit version: use multi-flavor path, throw if missing.
 * - No version: try multi-flavor "live" first, fall back to legacy Ketho path.
 */
export function resolveFrameXMLBase(version?: string): string {
  if (version !== undefined) {
    const multiFlavorPath = path.join(FRAMEXML_DIR, version, "Annotations");
    if (!existsSync(multiFlavorPath)) {
      throw new Error(
        "FrameXML annotation source not available at expected location; verify wow-annotations / wow-framexml are installed (run maintain-annotations.sh).",
      );
    }
    return multiFlavorPath;
  }

  // No version specified - try multi-flavor "live" first for seamless upgrade
  const liveMultiFlavorPath = path.join(FRAMEXML_DIR, "live", "Annotations");
  if (existsSync(liveMultiFlavorPath)) {
    return liveMultiFlavorPath;
  }

  // Fall back to legacy Ketho submodule path
  return LEGACY_FRAMEXML_BASE;
}

function assertFrameXMLExists(framexmlBase: string): void {
  if (!existsSync(framexmlBase)) {
    throw new Error(
      "FrameXML annotation source not available at expected location; verify wow-annotations / wow-framexml are installed (run maintain-annotations.sh).",
    );
  }
}

type FileType = "lua" | "xml" | "all";

function resolveSearchRoot(
  framexmlBase: string,
  addonsDir: string,
  addon: string | undefined,
): string {
  if (!addon) return framexmlBase;

  const addonPath = path.join(addonsDir, addon);
  if (!existsSync(addonPath) || !statSync(addonPath).isDirectory()) {
    throw new Error(
      `\`${addon}\` is not an addon directory in the FrameXML tree.`,
    );
  }
  return addonPath;
}

function globForFileType(fileType: FileType): string {
  if (fileType === "lua") return "*.lua.annotated.lua";
  if (fileType === "xml") return "*.xml.annotated.lua";
  return "*.lua";
}

function formatSourceOutput(framexmlBase: string, raw: string): string {
  return formatRgLines(framexmlBase, raw);
}

async function searchBlizzardSource(
  query: string,
  searchPath: string,
  caseSensitive: boolean,
  glob: string,
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
    glob,
    query,
    searchPath,
  ];
  return await runRg(args);
}

interface AddonInfo {
  name: string;
  luaCount: number;
  xmlCount: number;
}

function countFilesByPattern(dirPath: string, suffix: string): number {
  try {
    const raw = Bun.spawnSync(
      ["rg", "--files", "--glob", `*${suffix}`, dirPath],
      { stdout: "pipe", stderr: "pipe" },
    );
    const out = new TextDecoder().decode(raw.stdout).trim();
    if (!out) return 0;
    return out.split("\n").length;
  } catch {
    return 0;
  }
}

function listAddons(addonsDir: string): AddonInfo[] {
  if (!existsSync(addonsDir)) return [];

  const entries = readdirSync(addonsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const addonPath = path.join(addonsDir, e.name);
      return {
        name: e.name,
        luaCount: countFilesByPattern(addonPath, ".lua.annotated.lua"),
        xmlCount: countFilesByPattern(addonPath, ".xml.annotated.lua"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function filterAddons(addons: AddonInfo[], query: string): AddonInfo[] {
  const lower = query.toLowerCase();
  return addons.filter((a) => a.name.toLowerCase().includes(lower));
}

function formatAddonTable(addons: AddonInfo[]): string {
  const rows = addons.map(
    (a) => `| ${a.name} | ${a.luaCount} | ${a.xmlCount} |`,
  );
  return (
    "| Addon | Lua Files | XML Stubs |\n" +
    "|-------|-----------|----------|\n" +
    rows.join("\n")
  );
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

interface SourceMetadataOpts {
  query: string;
  mode: "search" | "list";
  addon?: string;
  fileType: FileType;
  version?: string;
  match:
    | "case-sensitive"
    | "case-insensitive"
    | "filename"
    | "list"
    | "none";
}

function buildSourceMetadata(opts: SourceMetadataOpts): MetadataPair[] {
  const metadata: MetadataPair[] = [
    ["Query", `\`${opts.query || "(empty)"}\``],
    ["Mode", opts.mode],
  ];
  if (opts.addon) metadata.push(["Addon", opts.addon]);
  metadata.push(["File-Type", opts.fileType]);
  if (opts.version) metadata.push(["Version", opts.version]);
  metadata.push(["Match", opts.match]);
  return metadata;
}

function buildSourceErrorMetadata(
  query: string,
  mode: "search" | "list",
  version: string | undefined,
): MetadataPair[] {
  const metadata: MetadataPair[] = [
    ["Query", `\`${query || "(empty)"}\``],
    ["Mode", mode],
  ];
  if (version) metadata.push(["Version", version]);
  return metadata;
}

export default tool({
  description:
    "Search Blizzard's FrameXML source (the annotated subset of Gethe/wow-ui-source via NumyAddon/FramexmlAnnotations) for implementation patterns, mixin definitions, template usage, and real-world examples of how Blizzard builds its own UI.\n\n" +
    "Usage:\n" +
    "- `query` is a search term (function name, mixin, template, keyword) in `mode: 'search'`, and a filter (substring of addon directory name) in `mode: 'list'`.\n" +
    "- `mode`: `search` (default) greps file contents; `list` enumerates addon directories.\n" +
    "- `addon`: narrow to a single addon directory (e.g. `Blizzard_ActionBar`, `Blizzard_AuctionHouseUI`, `Blizzard_ChatFrame`, `Blizzard_Communities`, `Blizzard_CompactRaidFrames`, `Blizzard_EditMode`, `Blizzard_ObjectiveTracker`, `Blizzard_Professions`, `Blizzard_Settings`, `SharedXML`).\n" +
    "- `file_type`: filter by file type - `lua` (only `*.lua.annotated.lua`), `xml` (only `*.xml.annotated.lua`), or `all` (default).\n" +
    "- `addon` and `file_type` can be combined (e.g. `addon: 'Blizzard_ActionBar', file_type: 'lua'`).\n" +
    "- `version`: annotation flavor (`live`, `classic`, `classic_era`, `classic_anniversary`); when omitted, falls back to the legacy single-flavor submodule.\n\n" +
    "DO NOT use this for documented C_ API — use `wow-api-lookup`.",
  args: {
    query: tool.schema
      .string()
      .describe(
        'Search term or filter. In `mode: "search"` (default) it is REQUIRED and is grepped against file contents. ' +
          'In `mode: "list"` it is OPTIONAL and acts as a substring filter on addon directory names; omit or pass an empty string to list all addons. ' +
          'Examples (search): "FramerateFrameMixin", "ObjectiveTracker", "SetAttribute", "RegisterEvent". ' +
          'Examples (list): "ActionBar" (filter), "" (list all).',
      ),
    mode: tool.schema
      .enum(["search", "list"])
      .optional()
      .default("search")
      .describe(
        '"search" (default) greps file contents inside the resolved tree (`query` REQUIRED). "list" enumerates addon directories under AddOns/ (`query` OPTIONAL, used as a substring filter). The semantics of `query` flip between the two modes - choose mode first, then `query` accordingly.',
      ),
    addon: tool.schema
      .string()
      .optional()
      .describe(
        'Narrow the search to a single addon directory under AddOns/ (e.g. "Blizzard_ActionBar", "SharedXML"). Omit to search the entire FrameXML tree. Has no effect in `mode: "list"`.',
      ),
    file_type: tool.schema
      .enum(["lua", "xml", "all"])
      .optional()
      .default("all")
      .describe(
        'Filter files by suffix: "lua" matches only `*.lua.annotated.lua`, "xml" matches only `*.xml.annotated.lua`, "all" (default) matches every `*.lua` annotation file. Has no effect in `mode: "list"`.',
      ),
    version: tool.schema
      .enum(["live", "classic", "classic_era", "classic_anniversary"])
      .optional()
      .describe(
        'WoW annotation flavor to search. One of the four checked-out flavors: "live" (retail), "classic" (current Classic/MoP cycle), "classic_era", "classic_anniversary". Omit to fall back to the legacy single-flavor submodule (used when multi-flavor annotations are not installed).',
      ),
  },
  async execute(args) {
    const { query, addon, mode = "search", version, file_type = "all" } = args;

    let framexmlBase: string;
    try {
      framexmlBase = resolveFrameXMLBase(version);
      assertFrameXMLExists(framexmlBase);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return renderError({
        title: TITLES.blizzardSource,
        metadata: buildSourceErrorMetadata(query, mode, version),
        reason: "Failed to resolve FrameXML annotation source.",
        cause: message,
        suggestions: [
          "Verify wow-annotations / wow-framexml are installed (run maintain-annotations.sh).",
          "Try a different `version` flavor or omit `version` to use the legacy submodule.",
        ],
      });
    }
    const addonsDir = path.join(framexmlBase, "AddOns");

    // ---- List mode --------------------------------------------------------
    if (mode === "list") {
      const addons = listAddons(addonsDir);
      const listMetadata = buildSourceMetadata({
        query,
        mode: "list",
        fileType: "all",
        version,
        match: "list",
      });

      if (addons.length === 0) {
        return renderNoMatch({
          title: TITLES.blizzardSource,
          metadata: listMetadata,
          paragraph: "No addon directories were found under AddOns/.",
          suggestions: [
            "Verify wow-framexml is installed (run maintain-annotations.sh).",
            "Try a different `version` flavor.",
          ],
        });
      }

      const filtered = query.trim() ? filterAddons(addons, query) : addons;

      if (filtered.length === 0) {
        return renderNoMatch({
          title: TITLES.blizzardSource,
          metadata: listMetadata,
          paragraph: `No addon directories matched the filter \`${query}\` (${addons.length} directories searched).`,
          suggestions: [
            "Try a broader filter or omit `query` to list every directory.",
            "Common addons: `Blizzard_ActionBar`, `Blizzard_ChatFrame`, `SharedXML`.",
          ],
        });
      }

      const intro = query.trim()
        ? `${filtered.length} addon(s) matching \`${query}\`:`
        : `${filtered.length} addon directories available:`;

      return renderReport({
        title: TITLES.blizzardSource,
        metadata: listMetadata,
        body: {
          outcome: "result",
          body: `${intro}\n\n${formatAddonTable(filtered)}`,
        },
      });
    }

    // ---- Search mode ------------------------------------------------------
    if (!query.trim()) {
      return renderError({
        title: TITLES.blizzardSource,
        metadata: buildSourceErrorMetadata(query, "search", version),
        reason: "`query` must not be empty in search mode.",
        cause: "(no query provided)",
        suggestions: [
          "Pass a search term (function name, mixin, template, keyword).",
          'Or use `mode: "list"` to browse addon directories.',
        ],
      });
    }

    let searchPath: string;
    try {
      searchPath = resolveSearchRoot(framexmlBase, addonsDir, addon);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return renderError({
        title: TITLES.blizzardSource,
        metadata: buildSourceErrorMetadata(query, "search", version),
        reason: "Addon directory not found.",
        cause: message,
        suggestions: [
          'Use `mode: "list"` to see available addon directories.',
          "Check spelling - addon names are case-sensitive (e.g. `Blizzard_ActionBar`, not `blizzard_actionbar`).",
        ],
      });
    }

    const fileGlob = globForFileType(file_type);

    // Step 1: Case-sensitive search with generous context
    let results = await searchBlizzardSource(
      query,
      searchPath,
      true,
      fileGlob,
      5,
      30,
    );
    if (results) {
      const formatted = formatSourceOutput(framexmlBase, results);
      const lineCount = formatted.split("\n").length;
      return renderReport({
        title: TITLES.blizzardSource,
        metadata: buildSourceMetadata({
          query,
          mode: "search",
          addon,
          fileType: file_type,
          version,
          match: "case-sensitive",
        }),
        body: { outcome: "result", body: "```lua\n" + formatted + "\n```" },
        notes:
          lineCount >= 200
            ? "- Showing partial results (max 30 matches per file). Narrow your query, addon, or file_type for more focused results."
            : undefined,
      });
    }

    // Step 2: Case-insensitive fallback with smaller context
    results = await searchBlizzardSource(
      query,
      searchPath,
      false,
      fileGlob,
      3,
      20,
    );
    if (results) {
      const formatted = formatSourceOutput(framexmlBase, results);
      return renderReport({
        title: TITLES.blizzardSource,
        metadata: buildSourceMetadata({
          query,
          mode: "search",
          addon,
          fileType: file_type,
          version,
          match: "case-insensitive",
        }),
        body: { outcome: "result", body: "```lua\n" + formatted + "\n```" },
      });
    }

    // Step 3: Filename-based fallback
    const fileResults = await runRg([
      "--files",
      "--glob",
      `*${query}*.lua`,
      searchPath,
    ]);
    if (fileResults) {
      const files = fileResults.split("\n").filter(Boolean);
      const listed = files
        .slice(0, 20)
        .map((f) => `- ${stripBasePath(framexmlBase, f)}`)
        .join("\n");
      const body =
        `No content matches for \`${query}\`, but found ${files.length} file(s) with matching names:\n\n` +
        listed;
      return renderReport({
        title: TITLES.blizzardSource,
        metadata: buildSourceMetadata({
          query,
          mode: "search",
          addon,
          fileType: file_type,
          version,
          match: "filename",
        }),
        body: { outcome: "result", body },
        notes:
          files.length > 20
            ? `- ${files.length - 20} more file(s) matched. Narrow your query.`
            : undefined,
      });
    }

    // Nothing found
    return renderNoMatch({
      title: TITLES.blizzardSource,
      metadata: buildSourceMetadata({
        query,
        mode: "search",
        addon,
        fileType: file_type,
        version,
        match: "none",
      }),
      paragraph: `No results for \`${query}\` in the resolved FrameXML tree (tried case-sensitive content search, case-insensitive content search, and filename match).`,
      suggestions: [
        "Drop the `addon` parameter to search the whole tree.",
        'Set `file_type: "all"` to include both Lua and XML annotation files.',
        "Search for the mixin or function name alone (e.g. `OnLoad` instead of `MyMixin:OnLoad`).",
        'Use `mode: "list"` with your query to find relevant addon directories.',
        "Check spelling - Blizzard source names are case-sensitive.",
      ],
    });
  },
});
