// tools/data/api-flavors.ts
//
// Curated per-flavor (retail / classic / classic_era / classic_anniversary)
// availability and signature data for WoW APIs that addons commonly trip
// over when targeting multiple flavors. Consumed by `wow-compat-check`.
//
// Curation principles:
//
//   * Quality over volume. v1 ships a small high-signal seed (~5-10 entries)
//     spanning the most common compat-break categories: mythic+/retail-only,
//     classic-legacy globals, profession overhaul, signature drift, and quiet
//     global differences. A separate authorship task grows the dataset
//     toward 50-150 entries.
//   * Knowns only. The consuming tool reports rows for APIs it has data on
//     and silently omits everything else - false positives are the failure
//     mode that destroys trust in compat tools, so we eliminate them by
//     contract.
//   * `signature` is free-form so authors can paste the canonical wiki line
//     verbatim. `arity` is the only structured field the matcher needs and
//     is derived by the author at curation time.
//   * `classic_anniversary` falls back to `classic_era` data when no
//     anniversary-specific entry exists - the consuming tool documents the
//     fallback in its `## Notes` output. Add a `classic_anniversary`
//     presence only when it materially diverges from `classic_era`.

export type Flavor =
  | "retail"
  | "classic"
  | "classic_era"
  | "classic_anniversary";

export const ALL_FLAVORS: readonly Flavor[] = [
  "retail",
  "classic",
  "classic_era",
  "classic_anniversary",
];

export type Arity =
  | { readonly required: number; readonly optional: number }
  | { readonly variadic: true; readonly minRequired: number };

export interface FlavorPresence {
  /** Version this API first appeared in this flavor, e.g. "10.0.0", "1.14.0". */
  readonly since?: string;
  /** Version this API was removed in this flavor, when applicable. */
  readonly removed?: string;
  /** Free-form canonical Lua signature, ideally pasted from the wiki. */
  readonly signature?: string;
  /** Structured arg-count fit, derived from `signature` at authoring time. */
  readonly arity?: Arity;
}

export interface ApiFlavorInfo {
  /** "C_PlayerInfo.GetPlayerMythicPlusRatingSummary" or "GetCVar". */
  readonly name: string;
  readonly kind: "namespaced" | "global";
  readonly flavors: {
    readonly retail?: FlavorPresence;
    readonly classic?: FlavorPresence;
    readonly classic_era?: FlavorPresence;
    readonly classic_anniversary?: FlavorPresence;
  };
  /** 1-line caveat surfaced under `## Notes` when this entry is matched. */
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Seed dataset (v1)
// ---------------------------------------------------------------------------

export const API_FLAVORS: readonly ApiFlavorInfo[] = [
  // --- Mythic+ / retail endgame --------------------------------------------
  {
    name: "C_PlayerInfo.GetPlayerMythicPlusRatingSummary",
    kind: "namespaced",
    flavors: {
      retail: {
        since: "10.0.0",
        signature:
          "C_PlayerInfo.GetPlayerMythicPlusRatingSummary(playerToken) -> summary",
        arity: { required: 1, optional: 0 },
      },
    },
    notes:
      "Retail-only mythic+ endgame surface; the entire C_ChallengeMode + M+ rating API is absent on classic flavors.",
  },

  // --- Retail-only profession overhaul -------------------------------------
  {
    name: "C_TradeSkillUI.GetRecipeSchematic",
    kind: "namespaced",
    flavors: {
      retail: {
        since: "10.0.0",
        signature:
          "C_TradeSkillUI.GetRecipeSchematic(recipeID, isRecraft, recipeLevel?) -> schematic",
        arity: { required: 2, optional: 1 },
      },
    },
    notes:
      "Dragonflight profession overhaul. Classic flavors expose the legacy `C_TradeSkillUI.GetRecipeInfo` shape instead.",
  },

  // --- Classic-legacy / removed-on-retail ----------------------------------
  {
    name: "GetTalentInfo",
    kind: "global",
    flavors: {
      retail: {
        // 10.0 removed the legacy talent system entirely; the surviving
        // retail GetTalentInfo is a different (talent-tree) shape and is
        // typically accessed via C_ClassTalents. We treat the legacy form
        // as removed on retail to flag classic addons that still call it.
        removed: "10.0.0",
      },
      classic: {
        since: "1.13.2",
        signature:
          "GetTalentInfo(tabIndex, talentIndex, isInspect?, isPet?, talentGroup?) -> name, iconTexture, tier, column, currentRank, maxRank",
        arity: { required: 2, optional: 3 },
      },
      classic_era: {
        since: "1.13.2",
        signature:
          "GetTalentInfo(tabIndex, talentIndex, isInspect?, isPet?, talentGroup?) -> name, iconTexture, tier, column, currentRank, maxRank",
        arity: { required: 2, optional: 3 },
      },
    },
    notes:
      "Legacy talent API. Retail 10.0 reworked talents into trees; the surviving retail call lives on `C_ClassTalents` and has a different shape.",
  },

  // --- Signature drift across flavors --------------------------------------
  {
    name: "C_QuestLog.GetQuestInfo",
    kind: "namespaced",
    flavors: {
      retail: {
        since: "9.0.0",
        signature: "C_QuestLog.GetQuestInfo(questID) -> questInfo",
        arity: { required: 1, optional: 0 },
      },
      classic: {
        since: "1.14.0",
        signature: "C_QuestLog.GetQuestInfo(questLogIndex) -> questTitle",
        arity: { required: 1, optional: 0 },
      },
      classic_era: {
        since: "1.14.0",
        signature: "C_QuestLog.GetQuestInfo(questLogIndex) -> questTitle",
        arity: { required: 1, optional: 0 },
      },
    },
    notes:
      "Same name, different semantics: retail takes a questID and returns a structured table; classic takes a quest-log index and returns just the title string.",
  },

  // --- Quiet global differences --------------------------------------------
  {
    name: "GetCVar",
    kind: "global",
    flavors: {
      retail: {
        since: "1.0.0",
        signature: "GetCVar(name) -> value",
        arity: { required: 1, optional: 0 },
      },
      classic: {
        since: "1.0.0",
        signature: "GetCVar(name) -> value",
        arity: { required: 1, optional: 0 },
      },
      classic_era: {
        since: "1.0.0",
        signature: "GetCVar(name) -> value",
        arity: { required: 1, optional: 0 },
      },
    },
    notes:
      "Shape is stable across flavors but the set of valid CVar names differs - a name that exists on retail may silently return nil on classic and vice versa.",
  },

  {
    name: "IsSpellKnown",
    kind: "global",
    flavors: {
      retail: {
        since: "1.0.0",
        signature: "IsSpellKnown(spellID, isPetSpell?) -> isKnown",
        arity: { required: 1, optional: 1 },
      },
      classic: {
        since: "1.13.0",
        signature: "IsSpellKnown(spellID, isPetSpell?) -> isKnown",
        arity: { required: 1, optional: 1 },
      },
      classic_era: {
        since: "1.13.0",
        signature: "IsSpellKnown(spellID, isPetSpell?) -> isKnown",
        arity: { required: 1, optional: 1 },
      },
    },
    notes:
      "Available everywhere but spellID stability across flavors is poor - the same logical spell often has different IDs per flavor.",
  },

  {
    name: "UnitAura",
    kind: "global",
    flavors: {
      retail: {
        // Deprecated in retail 10.2.5 in favor of C_UnitAuras.GetAuraDataByIndex.
        // Still works for now but flagged via `notes`.
        since: "1.0.0",
        signature: "UnitAura(unit, index, filter?) -> name, ...",
        arity: { required: 2, optional: 1 },
      },
      classic: {
        since: "1.13.0",
        signature: "UnitAura(unit, index, filter?) -> name, ...",
        arity: { required: 2, optional: 1 },
      },
      classic_era: {
        since: "1.13.0",
        signature: "UnitAura(unit, index, filter?) -> name, ...",
        arity: { required: 2, optional: 1 },
      },
    },
    notes:
      "Retail 10.2.5 deprecated `UnitAura` in favor of `C_UnitAuras.GetAuraDataByIndex`; classic flavors continue to expose the legacy global.",
  },
];

// ---------------------------------------------------------------------------
// Derived lookup structures
// ---------------------------------------------------------------------------

/**
 * O(1) lookup by API name. Built eagerly at module-import time so a
 * duplicate `name` surfaces as a thrown error in CI / dev rather than at
 * the first user call site.
 */
export const API_FLAVOR_MAP: ReadonlyMap<string, ApiFlavorInfo> = (() => {
  const m = new Map<string, ApiFlavorInfo>();
  for (const entry of API_FLAVORS) {
    if (m.has(entry.name)) {
      throw new Error(`Duplicate api-flavors entry: ${entry.name}`);
    }
    m.set(entry.name, entry);
  }
  return m;
})();

/** Names of every entry with `kind: "global"` - used to bound the global scan. */
export const KNOWN_GLOBAL_NAMES: ReadonlySet<string> = new Set(
  API_FLAVORS.filter((e) => e.kind === "global").map((e) => e.name),
);
