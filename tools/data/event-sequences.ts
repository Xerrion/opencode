// tools/data/event-sequences.ts
//
// Curated "what fires when" event sequences for ~17 well-known WoW addon-dev
// workflows. Consumed by `wow-event-info` in `mode: "sequence"`.
//
// Payloads are deliberately NOT inlined here — they are looked up at runtime
// against the live `Event.lua` annotation map so that this file stays a pure
// ordering + intent dataset and does not drift from the canonical signatures.

export interface ScenarioEvent {
  /** UPPER_SNAKE_CASE event name; payload is resolved at runtime. */
  readonly name: string;
  /** One-line cue describing when (in the workflow) this event fires. */
  readonly when: string;
  /** Optional disambiguation note ("use this one for X"). */
  readonly note?: string;
}

export interface Scenario {
  /** Canonical kebab-case slug. Unique across the dataset. */
  readonly key: string;
  /** Human label rendered in result and ambiguous tables. */
  readonly title: string;
  /** Lowercased natural-language search terms a developer would type. */
  readonly keywords: readonly string[];
  /** 1-2 sentence summary rendered above the event sequence. */
  readonly description: string;
  /** Ordered event sequence. */
  readonly events: readonly ScenarioEvent[];
  /** Cross-cutting caveats rendered under `## Notes`. */
  readonly notes?: string;
  /** Other scenario keys to suggest in `### See Also`. */
  readonly seeAlso?: readonly string[];
}

export const SCENARIOS = [
  {
    key: "addon-load",
    title: "Addon load lifecycle",
    keywords: ["addon", "addon load", "load", "startup", "login", "init"],
    description:
      "The events that fire as an addon is loaded, the player logs in, and the world is entered. Use these to stage SavedVariables init, build UI, and run zone-aware setup.",
    events: [
      {
        name: "ADDON_LOADED",
        when: "Each addon's Lua has been loaded by the client",
        note: "Use for SavedVariables init; check the addon-name arg matches yours and unregister once handled.",
      },
      {
        name: "PLAYER_LOGIN",
        when: "All addons have loaded and player data is available",
      },
      {
        name: "PLAYER_ENTERING_WORLD",
        when: "World/zone is loaded and the UI is visible",
        note: "isInitialLogin and isReloadingUi payload args; PEW also fires on every zone change, not just login.",
      },
    ],
    seeAlso: ["zone-change", "logout"],
  },
  {
    key: "combat-state",
    title: "Entering and leaving combat",
    keywords: ["combat", "in combat", "regen", "combat state", "lockdown"],
    description:
      "Combat enter/leave bracket. Note the inverted naming: 'regen disabled' means combat is starting (because health/power regen is now disabled).",
    events: [
      {
        name: "PLAYER_REGEN_DISABLED",
        when: "Combat starts",
        note: "Combat START — defer any secure-frame mutations until combat ends.",
      },
      {
        name: "PLAYER_REGEN_ENABLED",
        when: "Combat ends",
        note: "Combat END — safe to perform protected/secure UI changes again.",
      },
    ],
    notes:
      "InCombatLockdown() is the synchronous query that mirrors this state. Any secure-frame work queued during combat should drain on PLAYER_REGEN_ENABLED.",
  },
  {
    key: "zone-change",
    title: "Zone transitions",
    keywords: ["zone", "zone change", "map", "subzone", "area", "instance"],
    description:
      "Events that fire as the player crosses zone, subzone, or instance boundaries. Pick the granularity that matches your need.",
    events: [
      {
        name: "PLAYER_ENTERING_WORLD",
        when: "World finishes loading after a zone or instance transition",
      },
      {
        name: "ZONE_CHANGED_NEW_AREA",
        when: "Player crosses into a new top-level zone",
        note: "Use this for most map/zone-detection work — it is the coarsest, most reliable signal.",
      },
      {
        name: "ZONE_CHANGED",
        when: "Player crosses a subzone boundary inside the same zone",
      },
      {
        name: "ZONE_CHANGED_INDOORS",
        when: "Player moves between indoor and outdoor regions of a subzone",
      },
    ],
    seeAlso: ["addon-load"],
  },
  {
    key: "unit-spell-cast",
    title: "Unit spell cast lifecycle",
    keywords: ["spell", "cast", "spellcast", "unit cast", "casting"],
    description:
      "The lifecycle of a single spell cast on a unit. Each event carries the unit token and a cast GUID so handlers can correlate START with the eventual SUCCEEDED/FAILED/INTERRUPTED.",
    events: [
      {
        name: "UNIT_SPELLCAST_START",
        when: "Cast bar appears and casting begins",
        note: "Use to start cast-bar UI; carries castGUID to correlate later events.",
      },
      {
        name: "UNIT_SPELLCAST_SUCCEEDED",
        when: "Cast resolved successfully on the server",
        note: "Use this to trigger cooldown UI — fires for both channeled and instant casts.",
      },
      {
        name: "UNIT_SPELLCAST_STOP",
        when: "Cast bar disappears for any reason",
        note: "Use for UI cleanup; fires after SUCCEEDED, FAILED, and INTERRUPTED.",
      },
      {
        name: "UNIT_SPELLCAST_FAILED",
        when: "Cast did not resolve (out of range, moved, etc.)",
        note: "Use to flash an error state; pair with STOP for cleanup.",
      },
      {
        name: "UNIT_SPELLCAST_INTERRUPTED",
        when: "Cast interrupted by another unit or a stun",
        note: "Use to highlight kicks/silences; arrives before the matching STOP.",
      },
    ],
  },
  {
    key: "loot-opened",
    title: "Looting a corpse or chest",
    keywords: ["loot", "loot opened", "loot window", "looting"],
    description:
      "The loot window lifecycle. LOOT_READY can fire twice and arrives slightly earlier than the visible window; LOOT_OPENED is the right hook for UI work.",
    events: [
      {
        name: "LOOT_READY",
        when: "Loot data is available on the client",
        note: "May double-fire; fires before LOOT_OPENED. Prefer LOOT_OPENED for UI hooks.",
      },
      {
        name: "LOOT_OPENED",
        when: "Loot window appears",
        note: "Preferred hook for loot-UI work — single fire per window.",
      },
      {
        name: "LOOT_SLOT_CLEARED",
        when: "An individual loot slot is taken or removed",
      },
      {
        name: "LOOT_CLOSED",
        when: "Loot window closes (manually or via auto-loot completion)",
      },
    ],
    seeAlso: ["bag-update"],
  },
  {
    key: "bag-update",
    title: "Inventory / bag changes",
    keywords: ["bag", "bag update", "inventory", "item", "container"],
    description:
      "Bag and inventory mutation events. BAG_UPDATE is per-slot and bursty; BAG_UPDATE_DELAYED coalesces a burst into one event per UI tick and is almost always the right choice.",
    events: [
      {
        name: "BAG_UPDATE",
        when: "A single bag slot changes",
        note: "Fires once per slot change — can fire many times in rapid succession during loot/AH actions.",
      },
      {
        name: "BAG_UPDATE_DELAYED",
        when: "All BAG_UPDATEs for this UI tick have been delivered",
        note: "Preferred — coalesces bursts. Hook this for inventory scans instead of BAG_UPDATE.",
      },
      {
        name: "ITEM_LOCK_CHANGED",
        when: "An item slot is locked or unlocked (e.g. while moving)",
      },
    ],
    seeAlso: ["loot-opened", "vendor", "mail"],
  },
  {
    key: "vendor",
    title: "Vendor (merchant) interaction",
    keywords: ["vendor", "merchant", "shop", "sell", "buy"],
    description:
      "Merchant window open/refresh/close. MERCHANT_UPDATE fires on inventory refresh while the window is open (e.g. after a buy/sell).",
    events: [
      {
        name: "MERCHANT_SHOW",
        when: "Merchant window appears",
      },
      {
        name: "MERCHANT_UPDATE",
        when: "Merchant inventory or buyback list changes while open",
      },
      {
        name: "MERCHANT_CLOSED",
        when: "Merchant window closes",
      },
    ],
    seeAlso: ["bag-update"],
  },
  {
    key: "quest-lifecycle",
    title: "Quest accept / turn-in / abandon",
    keywords: ["quest", "questing", "quest accept", "turn in", "objective"],
    description:
      "The lifecycle of a single quest from offered detail through removal. QUEST_LOG_UPDATE is noisy — use it sparingly and prefer the targeted lifecycle events when you can.",
    events: [
      {
        name: "QUEST_DETAIL",
        when: "Quest-giver shows the quest detail/accept frame",
      },
      {
        name: "QUEST_ACCEPTED",
        when: "Player accepts the quest",
      },
      {
        name: "QUEST_TURNED_IN",
        when: "Player completes a turn-in",
      },
      {
        name: "QUEST_REMOVED",
        when: "Quest leaves the log (turn-in or abandon)",
      },
      {
        name: "QUEST_LOG_UPDATE",
        when: "Quest log data changes — fires very frequently",
        note: "Fires often (objective progress, server sync). Use sparingly; prefer the targeted lifecycle events above.",
      },
    ],
  },
  {
    key: "group-roster",
    title: "Party / raid roster changes",
    keywords: ["group", "party", "raid", "roster", "group roster"],
    description:
      "Roster mutation events fired when the player joins/leaves a group, members are added/removed, or leadership changes.",
    events: [
      {
        name: "GROUP_ROSTER_UPDATE",
        when: "Party or raid roster changes",
        note: "Replaced PARTY_MEMBERS_CHANGED in 5.x. Use this as the primary roster signal.",
      },
      {
        name: "GROUP_FORMED",
        when: "A new group is formed (party/raid created)",
      },
      {
        name: "PARTY_LEADER_CHANGED",
        when: "Group leadership transfers to a new player",
      },
    ],
  },
  {
    key: "unit-health",
    title: "Unit health and power tracking",
    keywords: ["health", "power", "mana", "unit health", "hp"],
    description:
      "Per-unit health and power changes. Each event carries a unit token in the payload — filter on it to avoid handling every unit in the world.",
    events: [
      {
        name: "UNIT_HEALTH",
        when: "Unit current-health value changes",
      },
      {
        name: "UNIT_MAXHEALTH",
        when: "Unit max-health value changes",
      },
      {
        name: "UNIT_POWER_UPDATE",
        when: "Unit current-power (mana/rage/energy/etc.) changes",
      },
    ],
    notes:
      "UNIT_HEALTH_FREQUENT was removed in 8.0 — UNIT_HEALTH now fires at the higher cadence. Always check the unit-token payload arg to filter to the units you care about.",
  },
  {
    key: "target-change",
    title: "Target / focus changes",
    keywords: ["target", "focus", "targeting"],
    description:
      "Player target and focus mutation events, plus per-unit target changes for arbitrary units.",
    events: [
      {
        name: "PLAYER_TARGET_CHANGED",
        when: "Player's target changes",
      },
      {
        name: "PLAYER_FOCUS_CHANGED",
        when: "Player's focus changes",
      },
      {
        name: "UNIT_TARGET",
        when: "An arbitrary unit's target changes",
      },
    ],
  },
  {
    key: "talent-spec",
    title: "Specialization and talent changes",
    keywords: ["talent", "spec", "specialization", "talents"],
    description:
      "Spec switches and talent edits. Use these to invalidate spec-dependent caches (action bars, rotation helpers, etc.).",
    events: [
      {
        name: "PLAYER_SPECIALIZATION_CHANGED",
        when: "Player switches active specialization",
      },
      {
        name: "PLAYER_TALENT_UPDATE",
        when: "Talent selections change",
      },
      {
        name: "ACTIVE_TALENT_GROUP_CHANGED",
        when: "Active talent group switches (dual-spec era / loadout)",
      },
    ],
  },
  {
    key: "death-resurrect",
    title: "Player death and resurrection",
    keywords: ["death", "die", "resurrect", "rez", "ghost", "release"],
    description:
      "The death → ghost → alive cycle, plus inbound resurrection requests from other players.",
    events: [
      {
        name: "PLAYER_DEAD",
        when: "Player has died",
      },
      {
        name: "PLAYER_ALIVE",
        when: "Player resurrects (or releases to ghost form)",
        note: "Also fires on release-to-ghost — pair with PLAYER_UNGHOST to detect a true revive.",
      },
      {
        name: "PLAYER_UNGHOST",
        when: "Player returns from ghost form to a living body",
      },
      {
        name: "RESURRECT_REQUEST",
        when: "Another player offers a resurrection",
      },
    ],
  },
  {
    key: "mail",
    title: "Mailbox interaction",
    keywords: ["mail", "mailbox", "inbox"],
    description:
      "Mailbox window lifecycle and inbox refresh. MAIL_INBOX_UPDATE fires when the inbox payload arrives or refreshes.",
    events: [
      {
        name: "MAIL_SHOW",
        when: "Mailbox window appears",
      },
      {
        name: "MAIL_INBOX_UPDATE",
        when: "Inbox contents are received or refreshed",
      },
      {
        name: "MAIL_CLOSED",
        when: "Mailbox window closes",
      },
    ],
    seeAlso: ["bag-update"],
  },
  {
    key: "auction-house",
    title: "Auction house open / close",
    keywords: ["auction", "auction house", "ah"],
    description:
      "Auction house window lifecycle. Retail's AH is driven by C_AuctionHouse and emits many additional granular events; this scenario covers the universal show/close bracket.",
    events: [
      {
        name: "AUCTION_HOUSE_SHOW",
        when: "Auction house window appears",
      },
      {
        name: "AUCTION_HOUSE_CLOSED",
        when: "Auction house window closes",
      },
    ],
    notes:
      "Retail uses the C_AuctionHouse API and emits richer events (browse results, commodity purchase confirmations, etc.); this list is the lifecycle bracket common to all flavors.",
  },
  {
    key: "trade-window",
    title: "Player-to-player trade",
    keywords: ["trade", "trading", "trade window"],
    description:
      "The trade-window lifecycle from open through accept-state changes to close. Item changes fire as either side adds, removes, or swaps slots.",
    events: [
      {
        name: "TRADE_SHOW",
        when: "Trade window appears",
      },
      {
        name: "TRADE_PLAYER_ITEM_CHANGED",
        when: "An item slot on the player's side changes",
      },
      {
        name: "TRADE_ACCEPT_UPDATE",
        when: "Either side toggles their accept/ready state",
      },
      {
        name: "TRADE_CLOSED",
        when: "Trade window closes (completed or cancelled)",
      },
    ],
  },
  {
    key: "logout",
    title: "Logout, camp, and reload",
    keywords: ["logout", "log out", "camp", "quit", "reload", "exit"],
    description:
      "The events that fire as the client tears down — used to flush state into SavedVariables. Order matters: LOGOUT precedes QUITING.",
    events: [
      {
        name: "PLAYER_LOGOUT",
        when: "Logout/camp/reload has been initiated; the UI is about to tear down",
        note: "Last chance to write SavedVariables synchronously.",
      },
      {
        name: "PLAYER_QUITING",
        when: "Process is exiting",
      },
    ],
    notes:
      "SavedVariables are written between PLAYER_LOGOUT and process exit. Do NOT call C_Timer functions in these handlers — the scheduler is shutting down and timers will not fire.",
    seeAlso: ["addon-load"],
  },
] as const satisfies readonly Scenario[];
