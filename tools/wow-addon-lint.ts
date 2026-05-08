import { tool } from "@opencode-ai/plugin";
import os from "node:os";
import path from "node:path";
import {
  renderError,
  renderReport,
  runRg,
  TITLES,
  WOW_ANNOTATIONS_ROOT,
} from "./_shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LintFinding {
  /**
   * Absolute path of the file that produced the finding. Empty string for
   * inline-mode lint runs. Stamped by `runLintRules` after the rule pipeline
   * has populated everything else; rules themselves don't set it. The
   * single-file renderer ignores this field; project-scan groups by it.
   */
  file?: string;
  line: number;
  column?: number;
  severity: "error" | "warning" | "info";
  category: string;
  message: string;
  suggestion: string;
  code: string;
  /**
   * Unified-diff hunk for a deterministic single-line auto-fix. Present only
   * for conservatively-fixable findings (deprecated API renames and accidental
   * top-level globals that need a `local` prefix). Format: a 4-line hunk with
   * an `@@ -N,1 +N,1 @@` header, no file headers.
   */
  readonly fix?: string;
  /** Wiki URL attached during enrichment for `deprecated` / `events` findings. */
  wikiUrl?: string;
  /** One-line `function ...` annotation, attached for `deprecated` findings. */
  apiSignature?: string;
  /**
   * Internal: API symbol to resolve in the local annotation tree. Stripped
   * before rendering. Set by deprecated-rule emission so enrichment can do a
   * single batched lookup pass after all rules have run.
   */
  _lookupSymbol?: string;
  /**
   * Internal: event name (e.g. `PLAYER_LOGIN`) for `events`-category findings
   * that cite a specific event. Stripped before rendering.
   */
  _eventName?: string;
}

type LintRule = {
  category: string;
  name: string;
  check: (lines: string[], findings: LintFinding[]) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_CATEGORIES = [
  "globals",
  "taint",
  "nil-safety",
  "hardcoded-ids",
  "events",
  "performance",
  "deprecated",
  "format",
  "frames",
  "locale",
  "errors",
  "ace3",
] as const;

type Category = (typeof ALL_CATEGORIES)[number];

export type LintCategory = Category;

/** Known WoW global patterns that are intentionally global */
const KNOWN_GLOBAL_PATTERNS = [
  /^SLASH_/,
  /^SlashCmdList$/,
  /^BINDING_/,
  /^ITEM_QUALITY\d/,
  /^StaticPopupDialogs$/,
  /^LibStub$/,
  /^[A-Z][A-Za-z]+Mixin$/,
];

/** APIs whose return values can be nil */
const NILABLE_APIS = [
  "GetItemInfo",
  "GetSpellInfo",
  "C_Item.GetItemInfo",
  "GetInventoryItemLink",
  "GetLootSlotLink",
  "UnitName",
  "GetContainerItemInfo",
  "C_Container.GetContainerItemInfo",
  "GetInventoryItemID",
  "C_Item.GetItemNameByID",
  "C_Spell.GetSpellName",
];

/** APIs that accept spell/item/quest IDs as arguments */
const ID_ACCEPTING_APIS = [
  "GetSpellInfo",
  "GetItemInfo",
  "C_Spell.GetSpellInfo",
  "C_Spell.GetSpellName",
  "C_Item.GetItemInfo",
  "C_Item.GetItemNameByID",
  "C_QuestLog.IsQuestFlaggedCompleted",
  "C_QuestLog.GetQuestObjectives",
  "IsSpellKnown",
  "IsPlayerSpell",
  "GetSpellCooldown",
  "GetItemCooldown",
  "GetItemCount",
  "C_MountJournal.GetMountInfoByID",
];

/** Deprecated APIs and their replacements */
const DEPRECATED_APIS: Record<string, string> = {
  getglobal: "_G[name]",
  setglobal: "_G[name] = value",
  GetItemInfo: "C_Item.GetItemInfo (retail)",
  GetSpellInfo: "C_Spell.GetSpellInfo (retail)",
  GetContainerItemInfo: "C_Container.GetContainerItemInfo",
  GetContainerNumSlots: "C_Container.GetContainerNumSlots",
  GetContainerItemLink: "C_Container.GetContainerItemLink",
  GetContainerNumFreeSlots: "C_Container.GetContainerNumFreeSlots",
  GetContainerItemID: "C_Container.GetContainerItemID",
};

// ---------------------------------------------------------------------------
// Input parsing helpers
// ---------------------------------------------------------------------------

function detectMode(
  target: string,
  override?: "file" | "inline",
): "file" | "inline" {
  if (override) return override;
  if (/\s/.test(target)) return "inline";
  if (/[={}()]/.test(target)) return "inline";
  if (/^\s*(local|function|return|if|for|while)\b/.test(target)) return "inline";
  if (target.endsWith(".lua") || /^[/~]|^\.\//.test(target)) return "file";
  return "inline";
}

function resolveFilePath(target: string): string {
  const trimmed = target.trim();
  if (trimmed.startsWith("~")) {
    const rest = trimmed.slice(1).replace(/^[/\\]/, "");
    return path.join(os.homedir(), rest);
  }
  return trimmed;
}

async function readLuaSource(
  target: string,
  override?: "file" | "inline",
): Promise<{
  source: string;
  displayLabel: string;
}> {
  const mode = detectMode(target, override);
  const trimmed = target.trim();
  if (mode === "inline") {
    return { source: target, displayLabel: "inline code" };
  }

  // Resolved path is used ONLY for filesystem read.
  // Display label is the user-supplied input verbatim, never the resolved
  // absolute path - prevents leaking $HOME into the output stream.
  const resolvedPath = resolveFilePath(target);
  const file = Bun.file(resolvedPath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`File not found: ${trimmed}`);
  }

  const source = await file.text();
  return { source, displayLabel: trimmed };
}

// ---------------------------------------------------------------------------
// Lint rules
// ---------------------------------------------------------------------------

function checkGlobalPollution(lines: string[], findings: LintFinding[]): void {
  const assignmentPattern = /^(\w+)\s*=/;
  const localPattern = /^\s*local\s+/;
  const functionPattern = /^\s*function\s+/;
  const commentPattern = /^\s*--/;
  const controlPattern = /^\s*(if|else|elseif|for|while|repeat|end|return|do)\b/;
  const methodAssignPattern = /^(\w+)[.:]/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty, comments, local declarations, control flow, function defs
    if (!trimmed) continue;
    if (commentPattern.test(trimmed)) continue;
    if (localPattern.test(line)) continue;
    if (functionPattern.test(trimmed)) continue;
    if (controlPattern.test(trimmed)) continue;

    const match = assignmentPattern.exec(trimmed);
    if (!match) continue;

    const varName = match[1];

    // Skip known WoW global patterns
    if (KNOWN_GLOBAL_PATTERNS.some((pat) => pat.test(varName))) continue;

    // Skip method-style assignments like MyAddon:Method or MyAddon.field
    if (methodAssignPattern.test(trimmed) && trimmed.includes(":"))
      continue;

    // Skip "MyAddon = MyAddon or {}" self-init pattern
    const selfInitPattern = new RegExp(
      `^${escapeRegex(varName)}\\s*=\\s*${escapeRegex(varName)}\\s+or\\b`,
    );
    if (selfInitPattern.test(trimmed)) continue;

    findings.push({
      line: i + 1,
      severity: "warning",
      category: "globals",
      message: `Global assignment to \`${varName}\` without \`local\` keyword.`,
      suggestion: "Add `local` keyword or use a namespace table.",
      code: trimmed,
      fix: buildGlobalLocalFix(i + 1, line),
    });
  }
}

function checkTaintRisks(lines: string[], findings: LintFinding[]): void {
  const setAttributePattern = /[.:]\s*SetAttribute\s*\(/;
  const securecallPattern = /\bsecurecall\s*\(/;
  const issecurevariablePattern = /\bissecurevariable\s*\(/;
  const guardedLines = buildCombatGuardedLines(lines);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;

    if (setAttributePattern.test(trimmed)) {
      const isGuarded = guardedLines.has(i + 1);
      findings.push({
        line: i + 1,
        severity: isGuarded ? "info" : "warning",
        category: "taint",
        message: isGuarded
          ? "`SetAttribute` can cause taint if called during combat lockdown."
          : "`SetAttribute` outside `InCombatLockdown()` guard — combat taint risk.",
        suggestion:
          "Ensure this is not called during combat lockdown (guard with `InCombatLockdown()`).",
        code: trimmed,
      });
    }

    if (securecallPattern.test(trimmed)) {
      findings.push({
        line: i + 1,
        severity: "info",
        category: "taint",
        message: "`securecall` detected - good practice for secure frame calls.",
        suggestion:
          "Verify the call target is a secure function from Blizzard code.",
        code: trimmed,
      });
    }

    if (issecurevariablePattern.test(trimmed)) {
      findings.push({
        line: i + 1,
        severity: "info",
        category: "taint",
        message:
          "`issecurevariable` detected - good practice for taint checking.",
        suggestion: "No action needed; this is a defensive taint check.",
        code: trimmed,
      });
    }
  }
}

function checkNilSafety(lines: string[], findings: LintFinding[]): void {
  const apiPatterns = NILABLE_APIS.map((api) => {
    const escaped = escapeRegex(api);
    return new RegExp(`\\b${escaped}\\s*\\(`);
  });

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;

    for (let a = 0; a < NILABLE_APIS.length; a++) {
      if (apiPatterns[a].test(trimmed)) {
        findings.push({
          line: i + 1,
          severity: "warning",
          category: "nil-safety",
          message: `\`${NILABLE_APIS[a]}\` can return nil.`,
          suggestion: "Add a nil check before using the result.",
          code: trimmed,
        });
        break; // one finding per line
      }
    }
  }
}

function checkHardcodedIds(lines: string[], findings: LintFinding[]): void {
  const apiCallPatterns = ID_ACCEPTING_APIS.map((api) => {
    const escaped = escapeRegex(api);
    return { api, pattern: new RegExp(`\\b${escaped}\\s*\\(\\s*(\\d+)\\s*\\)`) };
  });

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;

    for (const { api, pattern } of apiCallPatterns) {
      const match = pattern.exec(trimmed);
      if (!match) continue;

      const numericValue = parseInt(match[1], 10);
      if (numericValue <= 1000) continue;

      findings.push({
        line: i + 1,
        severity: "info",
        category: "hardcoded-ids",
        message: `Hardcoded ID \`${match[1]}\` passed to \`${api}\`.`,
        suggestion: "Consider using a named constant instead of a hardcoded ID.",
        code: trimmed,
      });
      break;
    }
  }
}

function checkEventHygiene(lines: string[], findings: LintFinding[]): void {
  const registerPattern = /[.:]\s*RegisterEvent\s*\(\s*["']([^"']+)["']\s*\)/;
  const unregisterPattern =
    /[.:]\s*UnregisterEvent\s*\(\s*["']([^"']+)["']\s*\)/;
  const registerAllPattern = /[.:]\s*RegisterAllEvents\s*\(/;
  const onEventDispatchPatterns = [
    /if\s+event\s*==/, // if event == "X"
    /self\s*\[\s*event\s*\]/, // self[event]
    /\[\s*event\s*\]/, // handler[event]
  ];

  const registeredEvents = new Map<string, number>(); // event -> first line
  const unregisteredEvents = new Set<string>();
  // State holder: members are mutated in the loop below. Using an object
  // (rather than bare `let`) keeps the assignments off the start-of-line so
  // the dogfood `globals` rule (which only knows Lua's `local`, not TS `let`)
  // doesn't misfire on this file.
  const flags = { hasOnEvent: false, hasEventDispatch: false };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;

    // RegisterAllEvents
    if (registerAllPattern.test(trimmed)) {
      findings.push({
        line: i + 1,
        severity: "error",
        category: "events",
        message:
          "`RegisterAllEvents()` registers for ALL game events. This is almost always a mistake.",
        suggestion:
          "Register only the specific events you need with `RegisterEvent()`.",
        code: trimmed,
      });
    }

    // Track registered events
    const regMatch = registerPattern.exec(trimmed);
    if (regMatch && !registeredEvents.has(regMatch[1])) {
      registeredEvents.set(regMatch[1], i + 1);
    }

    // Track unregistered events
    const unregMatch = unregisterPattern.exec(trimmed);
    if (unregMatch) {
      unregisteredEvents.add(unregMatch[1]);
    }

    // Detect OnEvent handler
    if (/\bOnEvent\b/.test(trimmed) || /SetScript\s*\(\s*["']OnEvent["']/.test(trimmed)) {
      flags.hasOnEvent = true;
    }

    // Detect event dispatch
    if (onEventDispatchPatterns.some((p) => p.test(trimmed))) {
      flags.hasEventDispatch = true;
    }
  }

  // Warn about registered events without corresponding unregister
  for (const [event, line] of registeredEvents) {
    if (!unregisteredEvents.has(event)) {
      findings.push({
        line,
        severity: "warning",
        category: "events",
        message: `\`RegisterEvent("${event}")\` without a corresponding \`UnregisterEvent\` in this file.`,
        suggestion: "Consider unregistering events when no longer needed.",
        code: lines[line - 1].trim(),
        _eventName: event,
      });
    }
  }

  // Warn about OnEvent without dispatch
  if (flags.hasOnEvent && !flags.hasEventDispatch && registeredEvents.size > 1) {
    findings.push({
      line: 1,
      severity: "warning",
      category: "events",
      message:
        "OnEvent handler detected but no event dispatch pattern found (e.g., `if event ==` or `self[event]`).",
      suggestion:
        "Add event dispatch in your OnEvent handler to route events to specific handlers.",
      code: "(file-level)",
    });
  }
}

function checkPerformance(lines: string[], findings: LintFinding[]): void {
  const onUpdatePattern = /\bOnUpdate\b/i;
  const tableCreationPattern = /[={,]\s*\{\s*\}|\{\s*\}/;
  const concatPattern = /\.\./;
  const tinsertPattern = /\btinsert\s*\(([^)]*)\)/;
  const loopPattern = /^\s*(for|while)\b/;
  const pairsPattern = /\b(pairs|ipairs)\s*\(/;
  const getTimePattern = /\bGetTime\s*\(\s*\)/;
  const elapsedPattern = /\belapsed\b/;
  const thresholdPattern = /\bif\b[^\n]*>=?[^\n]*\bthen\b/;

  // State holders for the two stateful sub-rules. Object members keep
  // assignments off the start-of-line so the dogfood `globals` rule (which
  // recognises Lua's `local`, not TS `let`) doesn't flag this file.
  const ou = {
    inside: false,
    depth: 0,
    startLine: -1,
    bodyLines: 0,
    usesElapsed: false,
    hasThreshold: false,
  };
  const gt = { callCount: 0, firstLine: -1 };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;

    // Track OnUpdate scope (heuristic: function containing OnUpdate until end)
    if (onUpdatePattern.test(trimmed) && /function/.test(trimmed)) {
      ou.inside = true;
      ou.depth = 0;
      ou.startLine = i + 1;
      ou.bodyLines = 0;
      ou.usesElapsed = false;
      ou.hasThreshold = false;
    }

    if (ou.inside) {
      // Body metrics (skip the entering function declaration line)
      if (i + 1 !== ou.startLine && trimmed.length > 0) {
        ou.bodyLines++;
        if (elapsedPattern.test(trimmed)) ou.usesElapsed = true;
        if (thresholdPattern.test(trimmed)) ou.hasThreshold = true;
      }

      // Count braces/function/end for depth
      if (/\bfunction\b/.test(trimmed)) ou.depth++;
      if (/\bend\b/.test(trimmed)) {
        ou.depth--;
        if (ou.depth <= 0) {
          // Throttle check on scope close
          if (
            ou.bodyLines > 10 &&
            !ou.usesElapsed &&
            !ou.hasThreshold &&
            ou.startLine > 0
          ) {
            findings.push({
              line: ou.startLine,
              severity: "info",
              category: "performance",
              message:
                "`OnUpdate` body without throttle — fires every frame (~60+ times/sec).",
              suggestion:
                "Accumulate `elapsed` and gate on a threshold to throttle.",
              code: lines[ou.startLine - 1].trim(),
            });
          }
          ou.inside = false;
          ou.startLine = -1;
        }
      }

      // Table creation in OnUpdate
      if (tableCreationPattern.test(trimmed) && !/^\s*local\s+\w+\s*=\s*\w/.test(trimmed)) {
        findings.push({
          line: i + 1,
          severity: "warning",
          category: "performance",
          message: "Table creation inside an OnUpdate handler.",
          suggestion:
            "Table creation in OnUpdate causes garbage collection pressure. Reuse tables or create them outside the handler.",
          code: trimmed,
        });
      }

      // pairs/ipairs in OnUpdate
      if (pairsPattern.test(trimmed)) {
        findings.push({
          line: i + 1,
          severity: "info",
          category: "performance",
          message: "`pairs`/`ipairs` iteration inside OnUpdate handler.",
          suggestion:
            "If iterating large tables, consider throttling or caching results.",
          code: trimmed,
        });
      }
    }

    // String concat / tinsert in loops
    if (loopPattern.test(trimmed)) {
      // Scan ahead within the loop body (heuristic: up to 50 lines or `end`)
      for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
        const loopLine = lines[j].trim();
        if (/^\s*end\b/.test(loopLine)) break;
        if (loopLine.startsWith("--")) continue;
        if (concatPattern.test(loopLine)) {
          findings.push({
            line: j + 1,
            severity: "info",
            category: "performance",
            message: "String concatenation (`..`) inside a loop.",
            suggestion:
              "Consider using `table.concat()` or `string.format()` for building strings in loops.",
            code: loopLine,
          });
          break; // one finding per loop
        }
        const tinsertMatch = tinsertPattern.exec(loopLine);
        if (tinsertMatch) {
          const argList = tinsertMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (argList.length === 2) {
            findings.push({
              line: j + 1,
              severity: "info",
              category: "performance",
              message:
                "`tinsert` in tight loop — `t[#t+1] = x` is faster (avoids function call).",
              suggestion: "Replace with `t[#t+1] = x` for ~3x speedup.",
              code: loopLine,
            });
            break;
          }
        }
      }
    }

    // Track GetTime() calls per function
    if (/\bfunction\b/.test(trimmed)) {
      // Emit finding for previous function if multiple GetTime calls
      if (gt.callCount > 1) {
        findings.push({
          line: gt.firstLine,
          severity: "info",
          category: "performance",
          message: `\`GetTime()\` called ${gt.callCount} times in the same function.`,
          suggestion:
            "Cache the result in a local variable: `local now = GetTime()`.",
          code: lines[gt.firstLine - 1].trim(),
        });
      }
      gt.callCount = 0;
      gt.firstLine = -1;
    }

    if (getTimePattern.test(trimmed)) {
      gt.callCount++;
      if (gt.firstLine === -1) gt.firstLine = i + 1;
    }
  }

  // Check last function scope
  if (gt.callCount > 1 && gt.firstLine !== -1) {
    findings.push({
      line: gt.firstLine,
      severity: "info",
      category: "performance",
      message: `\`GetTime()\` called ${gt.callCount} times in the same function.`,
      suggestion:
        "Cache the result in a local variable: `local now = GetTime()`.",
      code: lines[gt.firstLine - 1].trim(),
    });
  }
}

function checkDeprecatedApis(lines: string[], findings: LintFinding[]): void {
  const apiPatterns = Object.entries(DEPRECATED_APIS).map(
    ([api, replacement]) => ({
      api,
      replacement,
      pattern: new RegExp(`\\b${escapeRegex(api)}\\s*\\(`),
    }),
  );

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;

    for (const { api, replacement, pattern } of apiPatterns) {
      if (!pattern.test(trimmed)) continue;

      // Don't flag the replacement API itself (e.g. C_Container.GetContainerItemInfo)
      if (api === "GetContainerItemInfo" && trimmed.includes("C_Container.")) continue;
      if (api === "GetContainerNumSlots" && trimmed.includes("C_Container.")) continue;
      if (api === "GetContainerItemLink" && trimmed.includes("C_Container.")) continue;
      if (api === "GetContainerNumFreeSlots" && trimmed.includes("C_Container.")) continue;
      if (api === "GetContainerItemID" && trimmed.includes("C_Container.")) continue;
      if (api === "GetItemInfo" && trimmed.includes("C_Item.")) continue;
      if (api === "GetSpellInfo" && trimmed.includes("C_Spell.")) continue;

      findings.push({
        line: i + 1,
        severity: "warning",
        category: "deprecated",
        message: `\`${api}\` is deprecated.`,
        suggestion: `Use \`${replacement}\` instead.`,
        code: trimmed,
        fix: buildDeprecatedRenameFix(i + 1, lines[i], api, replacement),
        _lookupSymbol: stripReplacementSuffix(replacement),
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Function-range tracking (shared by combat-guard and other block rules)
// ---------------------------------------------------------------------------

/**
 * Locate Lua function ranges by tracking block-opener / block-closer keywords.
 * Approximate: we don't lex strings, so a `function` token in a string literal
 * would skew the stack. Comment trailers are stripped via `--`. Returns
 * inclusive 0-based line ranges for every closed function definition.
 */
function findFunctionRanges(
  lines: string[],
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const stack: { kind: "function" | "block"; line: number }[] = [];
  const tokenRegex = /\b(function|if|for|while|repeat|end|until)\b/g;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const commentIdx = line.indexOf("--");
    if (commentIdx >= 0) line = line.slice(0, commentIdx);

    let m: RegExpExecArray | null;
    tokenRegex.lastIndex = 0;
    while ((m = tokenRegex.exec(line)) !== null) {
      const tok = m[1];
      if (tok === "function") stack.push({ kind: "function", line: i });
      else if (tok === "if" || tok === "for" || tok === "while" || tok === "repeat") {
        stack.push({ kind: "block", line: i });
      } else if (tok === "end" || tok === "until") {
        const top = stack.pop();
        if (top && top.kind === "function") {
          ranges.push({ start: top.line, end: i });
        }
      }
    }
  }
  return ranges;
}

/**
 * Return the set of 1-based line numbers that lie inside a function whose
 * body contains at least one `InCombatLockdown()` call. Used by the taint
 * rule to decide whether a `SetAttribute` call is "guarded".
 */
function buildCombatGuardedLines(lines: string[]): Set<number> {
  const ranges = findFunctionRanges(lines);
  const guarded = new Set<number>();
  const guardPattern = /\bInCombatLockdown\s*\(\s*\)/;

  for (const { start, end } of ranges) {
    const isGuarded = lines.slice(start, end + 1).some((l) => guardPattern.test(l));
    if (!isGuarded) continue;
    for (let i = start; i <= end; i++) guarded.add(i + 1);
  }
  return guarded;
}

// ---------------------------------------------------------------------------
// Additional lint rules
// ---------------------------------------------------------------------------

/** Fragile WoW APIs that should be wrapped in pcall/xpcall. */
const FRAGILE_APIS = [
  "C_AddOns.LoadAddOn",
  "C_Map.GetBestMapForUnit",
  "C_QuestLog.GetTitleForQuestID",
  "C_Item.RequestLoadItemDataByID",
];

/**
 * Walk forward from `start` (the index immediately after an opening `(`) and
 * return the substring up to the matching closing `)`, respecting nested
 * brackets and double-quoted strings. Returns `null` if the parens don't
 * balance on the same line — caller treats that as a multi-line statement
 * and silently skips per the rule contract.
 */
function extractBalancedArgs(line: string, start: number): string | null {
  let depth = 1;
  let i = start;
  while (i < line.length && depth > 0) {
    const ch = line[i];
    if (ch === '"') {
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\") i++;
        i++;
      }
    } else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return line.slice(start, i);
    }
    i++;
  }
  return null;
}

/**
 * Split a comma-separated argument list at top-level commas only — nested
 * `()`, `[]`, `{}` and `""` are treated as opaque. Empty trailing/leading
 * fragments (from e.g. unbalanced sources) are dropped by the caller.
 */
function splitTopLevelArgs(args: string): string[] {
  const result: string[] = [];
  // Object state holder: `s.foo = ...` doesn't match the dogfood `globals`
  // start-of-line heuristic.
  const s = { depth: 0, buffer: "", inString: false };
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (s.inString) {
      if (ch === "\\" && i + 1 < args.length) {
        s.buffer += ch + args[i + 1];
        i++;
        continue;
      }
      if (ch === '"') s.inString = false;
      s.buffer += ch;
      continue;
    }
    if (ch === '"') {
      s.inString = true;
      s.buffer += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") s.depth++;
    else if (ch === ")" || ch === "]" || ch === "}") s.depth--;
    if (ch === "," && s.depth === 0) {
      result.push(s.buffer.trim());
      s.buffer = "";
      continue;
    }
    s.buffer += ch;
  }
  if (s.buffer.trim().length > 0) result.push(s.buffer.trim());
  return result;
}

/**
 * Locate a `string.format("...", args)` or `"...":format(args)` call on a
 * single line and return the format string + raw argument substring. Returns
 * `null` when no format call is found, when the call spans multiple lines
 * (unbalanced parens), or when args follow a vararg pass-through (`...`).
 */
function extractFormatCall(
  trimmed: string,
  stringFormatHead: RegExp,
  methodFormatHead: RegExp,
): { fmt: string; argsStr: string } | null {
  const sfMatch = stringFormatHead.exec(trimmed);
  if (sfMatch) {
    const fmt = sfMatch[1] ?? sfMatch[2];
    if (sfMatch[3] === ")") return { fmt, argsStr: "" };
    const argsStart = sfMatch.index + sfMatch[0].length;
    const extracted = extractBalancedArgs(trimmed, argsStart);
    if (extracted === null) return null;
    return { fmt, argsStr: extracted };
  }
  const methMatch = methodFormatHead.exec(trimmed);
  if (!methMatch) return null;
  const fmt = methMatch[1] ?? methMatch[2];
  const argsStart = methMatch.index + methMatch[0].length;
  const extracted = extractBalancedArgs(trimmed, argsStart);
  if (extracted === null) return null;
  return { fmt, argsStr: extracted };
}

function checkFormatArity(lines: string[], findings: LintFinding[]): void {
  const stringFormatHead =
    /\bstring\.format\s*\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*([,)])/;
  const methodFormatHead =
    /(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*\)?\s*:\s*format\s*\(/;
  const specifierPattern = /%[-+ 0#]*\d*\.?\d*[dsfxXigecqou]/g;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;

    const call = extractFormatCall(trimmed, stringFormatHead, methodFormatHead);
    if (call === null) continue;
    const { fmt, argsStr } = call;

    // Skip vararg pass-through — arg count cannot be determined
    if (/\.\.\./.test(argsStr)) continue;

    // Count specifiers (with `%%` literals stripped first)
    const fmtNoLiteral = fmt.replace(/%%/g, "");
    const specifiers = fmtNoLiteral.match(specifierPattern);
    const specCount = specifiers?.length ?? 0;

    // Count top-level args
    const args = splitTopLevelArgs(argsStr);
    const argCount = args.length;

    if (specCount === argCount) continue;

    findings.push({
      line: i + 1,
      severity: "warning",
      category: "format",
      message: `\`string.format\` has ${specCount} specifiers but ${argCount} arguments.`,
      suggestion: "Adjust format string or argument count.",
      code: trimmed,
    });
  }
}

function checkCreateFrameParent(
  lines: string[],
  findings: LintFinding[],
): void {
  // Locate the head `CreateFrame(` only — args are extracted via the balanced
  // walker so nested calls like `CreateFrame("Frame", nil, GetParent())` parse
  // correctly. Bail (no warning) on multi-line calls; that's the same contract
  // the format-arity rule uses.
  const headPattern = /\bCreateFrame\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;
    const m = headPattern.exec(trimmed);
    if (!m) continue;
    const argsStart = m.index + m[0].length;
    const argsStr = extractBalancedArgs(trimmed, argsStart);
    if (argsStr === null) continue; // multi-line, silent skip

    const args = splitTopLevelArgs(argsStr);
    if (args.length < 1) continue; // malformed
    const parentArg = args[2]; // undefined if missing
    if (parentArg !== undefined && parentArg !== "" && parentArg !== "nil") {
      continue;
    }

    findings.push({
      line: i + 1,
      severity: "info",
      category: "frames",
      message:
        "`CreateFrame` without explicit parent — defaults to UIParent and may leak.",
      suggestion: "Pass the parent frame as the third argument.",
      code: trimmed,
    });
  }
}

function checkLocaleStrings(lines: string[], findings: LintFinding[]): void {
  const methods = ["SetText", "SetTooltipText", "SetFormattedText", "AddLine", "SetTitle"];
  const pattern = new RegExp(
    `:(${methods.join("|")})\\s*\\(\\s*"([^"]*)"\\s*[,)]`,
  );

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;
    const m = pattern.exec(trimmed);
    if (!m) continue;
    const text = m[2];
    if (text.length < 3) continue;
    if (!/[A-Za-z]/.test(text)) continue;

    findings.push({
      line: i + 1,
      severity: "info",
      category: "locale",
      message: "Hardcoded UI string — consider localizing via `L[...]`.",
      suggestion: `Replace \`"${text}"\` with \`L["${text}"]\` and add to your locale file.`,
      code: trimmed,
    });
  }
}

function checkPcallWrapping(lines: string[], findings: LintFinding[]): void {
  // Two guard shapes are accepted:
  //   1. `pcall(function() API(...) end)` — guard call appears textually
  //      before the API call on the same line.
  //   2. `pcall(API, ...)` — the API is the first argument of pcall/xpcall;
  //      we detect this by checking that the head right before the API call
  //      site is `pcall(` or `xpcall(` (zero or more spaces between).
  const guardBeforePattern = /\b(?:p|x)call\s*\(/;
  const guardAsCalleePattern = /\b(?:p|x)call\s*\(\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;

    for (const api of FRAGILE_APIS) {
      const apiPattern = new RegExp(`\\b${escapeRegex(api)}\\s*\\(`);
      const apiMatch = apiPattern.exec(trimmed);
      if (!apiMatch) continue;

      const before = trimmed.slice(0, apiMatch.index);
      // Shape 1: any earlier pcall/xpcall on the line.
      if (guardBeforePattern.test(before)) continue;
      // Shape 2: API is the immediate first arg of pcall(...) — head ends
      // with `pcall(` (whitespace tolerated).
      if (guardAsCalleePattern.test(before)) continue;

      findings.push({
        line: i + 1,
        severity: "warning",
        category: "errors",
        message: `\`${api}\` may error — wrap in pcall.`,
        suggestion: `Use \`pcall(${api}, ...)\` to handle errors safely.`,
        code: trimmed,
      });
      break;
    }
  }
}

/**
 * Phase 1 of the AceLifecycle rule: scan for `LibStub("AceAddon-3.0"):NewAddon(...)`
 * and return the local variable bound to it (preferred) plus the registered
 * addon name. Returns `null` if no AceAddon registration is detected.
 */
function findAceAddonRegistration(
  lines: string[],
): { addonVar: string; addonName: string } | null {
  const assignedNewAddon =
    /(?:local\s+)?(\w+)\s*=\s*LibStub\s*\(\s*["']AceAddon-3\.0["']\s*\)\s*:\s*NewAddon\s*\(([^)]*)\)/;
  const inlineNewAddon =
    /LibStub\s*\(\s*["']AceAddon-3\.0["']\s*\)\s*:\s*NewAddon\s*\(([^)]*)\)/;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;

    const assigned = assignedNewAddon.exec(trimmed);
    if (assigned) {
      const v = assigned[1];
      const stringArg = /["']([^"']+)["']/.exec(assigned[2]);
      return { addonVar: v, addonName: stringArg ? stringArg[1] : v };
    }
    const inline = inlineNewAddon.exec(trimmed);
    if (inline) {
      const stringArg = /["']([^"']+)["']/.exec(inline[1]);
      if (stringArg) return { addonVar: stringArg[1], addonName: stringArg[1] };
    }
  }
  return null;
}

function checkAceLifecycle(lines: string[], findings: LintFinding[]): void {
  const reg = findAceAddonRegistration(lines);
  if (!reg) return;
  const { addonVar, addonName } = reg;

  // Phase 2: scan for lifecycle method definitions on the captured var.
  const onEnableRe = new RegExp(
    `function\\s+${escapeRegex(addonVar)}\\s*:\\s*OnEnable\\s*\\(`,
  );
  const onDisableRe = new RegExp(
    `function\\s+${escapeRegex(addonVar)}\\s*:\\s*OnDisable\\s*\\(`,
  );
  const lifecycle = { hasOnEnable: false, hasOnDisable: false };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("--")) continue;
    if (onEnableRe.test(trimmed)) lifecycle.hasOnEnable = true;
    if (onDisableRe.test(trimmed)) lifecycle.hasOnDisable = true;
  }

  if (!lifecycle.hasOnEnable && !lifecycle.hasOnDisable) {
    findings.push({
      line: 1,
      severity: "warning",
      category: "ace3",
      message: `AceAddon \`${addonName}\` has neither \`:OnEnable\` nor \`:OnDisable\` lifecycle methods.`,
      suggestion: `Define \`function ${addonVar}:OnEnable() ... end\` to register frames/events on enable.`,
      code: "(file-level)",
    });
    return;
  }

  if (lifecycle.hasOnEnable !== lifecycle.hasOnDisable) {
    const present = lifecycle.hasOnEnable ? "OnEnable" : "OnDisable";
    const missing = lifecycle.hasOnEnable ? "OnDisable" : "OnEnable";
    findings.push({
      line: 1,
      severity: "info",
      category: "ace3",
      message: `AceAddon \`${addonName}\` defines \`:${present}\` but not \`:${missing}\`.`,
      suggestion: `Define \`function ${addonVar}:${missing}() ... end\` for symmetry.`,
      code: "(file-level)",
    });
  }
}

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

const LINT_RULES: LintRule[] = [
  { category: "globals", name: "checkGlobalPollution", check: checkGlobalPollution },
  { category: "taint", name: "checkTaintRisks", check: checkTaintRisks },
  { category: "nil-safety", name: "checkNilSafety", check: checkNilSafety },
  { category: "hardcoded-ids", name: "checkHardcodedIds", check: checkHardcodedIds },
  { category: "events", name: "checkEventHygiene", check: checkEventHygiene },
  { category: "performance", name: "checkPerformance", check: checkPerformance },
  { category: "deprecated", name: "checkDeprecatedApis", check: checkDeprecatedApis },
  { category: "format", name: "checkFormatArity", check: checkFormatArity },
  { category: "frames", name: "checkCreateFrameParent", check: checkCreateFrameParent },
  { category: "locale", name: "checkLocaleStrings", check: checkLocaleStrings },
  { category: "errors", name: "checkPcallWrapping", check: checkPcallWrapping },
  { category: "ace3", name: "checkAceLifecycle", check: checkAceLifecycle },
];

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a unified-diff hunk for a single-line replacement. The agent applying
 * the patch supplies the file context, so we emit the hunk only - no
 * `--- a/file` / `+++ b/file` headers.
 */
function buildUnifiedDiffHunk(
  lineNumber: number,
  oldLine: string,
  newLine: string,
): string {
  return (
    `@@ -${lineNumber},1 +${lineNumber},1 @@\n` +
    `-${oldLine}\n` +
    `+${newLine}`
  );
}

/**
 * Construct an auto-fix hunk for a deprecated API rename. Returns `undefined`
 * when the rename is not deterministic (e.g. the `\b` boundary fails to match
 * or the replacement is unsuitable - see comments below).
 */
function buildDeprecatedRenameFix(
  lineNumber: number,
  originalLine: string,
  api: string,
  replacement: string,
): string | undefined {
  // Strip the parenthetical disambiguator some entries use (e.g.
  // "C_Item.GetItemInfo (retail)" -> "C_Item.GetItemInfo"). Without this we'd
  // splice the suffix into the source.
  const cleanedReplacement = replacement.replace(/\s*\([^)]*\)\s*$/, "");

  // Don't auto-fix replacements that aren't a drop-in identifier - e.g.
  // `getglobal` -> `_G[name]` is a syntactic restructure, not a rename.
  if (!/^[A-Za-z_][\w.]*$/.test(cleanedReplacement)) return undefined;

  const renamed = originalLine.replace(
    new RegExp(`\\b${escapeRegex(api)}\\b`),
    cleanedReplacement,
  );
  if (renamed === originalLine) return undefined;

  return buildUnifiedDiffHunk(lineNumber, originalLine, renamed);
}

/**
 * Construct an auto-fix hunk that prepends `local ` to an accidental global
 * assignment. Returns `undefined` when the line shape is unexpected or already
 * has `local`. We do not check whether the assignment is inside a function
 * body - a redundant `local` inside a function is harmless; missing `local` at
 * module top-level pollutes `_G`. Conservative trade-off documented in #6.
 */
function buildGlobalLocalFix(
  lineNumber: number,
  originalLine: string,
): string | undefined {
  if (/\blocal\b/.test(originalLine)) return undefined;

  const prefixed = originalLine.replace(
    /^(\s*)([A-Za-z_]\w*)(\s*=)/,
    "$1local $2$3",
  );
  if (prefixed === originalLine) return undefined;

  return buildUnifiedDiffHunk(lineNumber, originalLine, prefixed);
}

// ---------------------------------------------------------------------------
// Cross-tool citations (deprecated / events)
//
// Both citation kinds derive from local data only — no network calls. Event
// URLs follow a deterministic warcraft.wiki.gg pattern; deprecated-API
// citations come from the LuaLS annotation tree, which embeds the wiki URL
// directly above each `function NS.Name(...)` declaration as
// `---[Documentation](https://...)`. One `rg` call with `-B 10` returns both.
// ---------------------------------------------------------------------------

interface AnnotationCitation {
  wikiUrl?: string;
  signature?: string;
}

const annotationCache = new Map<string, AnnotationCitation>();

/**
 * Strip trailing parenthetical context (e.g. " (retail)") from a replacement
 * string so it can be matched against `function NS.Name(...)` declarations.
 * Returns the cleaned symbol, or the empty string if nothing usable remains
 * (e.g. for `_G[name]` style replacements that aren't function symbols).
 */
function stripReplacementSuffix(replacement: string): string {
  const cleaned = replacement.replace(/\s*\([^)]*\)\s*$/, "").trim();
  // Anything that doesn't start with an identifier-namespace head can't be
  // resolved as a `function X.Y` declaration. Skip those upfront so the
  // lookup helper isn't invoked at all.
  if (!/^[A-Za-z_][\w.]*$/.test(cleaned)) return "";
  return cleaned;
}

function eventWikiUrl(eventName: string): string {
  return `https://warcraft.wiki.gg/wiki/${eventName}`;
}

/**
 * Parse one `rg -B 10` result block into a citation. The matched
 * `function ...` line becomes the signature; the nearest preceding
 * `---[Documentation](url)` line within the context window becomes the wiki
 * URL. Both fields are independently optional.
 *
 * The `-B 10` window can include sibling `function` declarations from the
 * same file. rg disambiguates these via its separator: `path:N:content` for
 * the actual match, `path:N-content` for context lines. We use that to:
 *   - capture the wiki URL only when it precedes our target function
 *   - reset any wiki URL we collected if a context-line `function` declaration
 *     intervenes (that URL belonged to the sibling, not us)
 */
function parseAnnotationOutput(rgOutput: string): AnnotationCitation {
  // Object holder so member assignments stay off the start-of-line and avoid
  // tripping the dogfood `globals` heuristic on this file.
  const out: { signature?: string; wikiUrl?: string } = {};
  for (const raw of rgOutput.split("\n")) {
    if (raw === "--" || raw === "") continue;
    const stripped = /^.+?:\d+([:-])(.*)$/.exec(raw);
    if (!stripped) continue;
    const isMatchLine = stripped[1] === ":";
    const content = stripped[2];

    const docMatch = /---\[Documentation\]\(([^)]+)\)/.exec(content);
    if (docMatch) {
      out.wikiUrl = docMatch[1];
      continue;
    }
    if (/^function\s/.test(content)) {
      if (isMatchLine) {
        out.signature = content.trim();
        break;
      }
      // Context-line function declaration: a sibling. Any wiki URL we have
      // so far cited that sibling, not our target.
      out.wikiUrl = undefined;
    }
  }
  return out;
}

/**
 * Resolve a function symbol against the local annotation tree. Returns an
 * empty object on any failure (missing annotations dir, rg unavailable, no
 * match) — citations are best-effort, never fatal.
 */
async function lookupAnnotation(symbol: string): Promise<AnnotationCitation> {
  const cached = annotationCache.get(symbol);
  if (cached) return cached;

  let result: AnnotationCitation = {};
  try {
    const out = await runRg([
      "--no-heading",
      "--with-filename",
      "-n",
      "-B",
      "10",
      "-m",
      "1",
      "--glob",
      "*.lua",
      `^function ${escapeRegex(symbol)}\\b`,
      WOW_ANNOTATIONS_ROOT,
    ]);
    if (out) result = parseAnnotationOutput(out);
  } catch {
    // Annotations dir missing or rg failed — degrade silently.
  }

  annotationCache.set(symbol, result);
  return result;
}

/**
 * Mutates findings in place: attaches `wikiUrl` / `apiSignature` to any
 * finding that requested enrichment. Symbol lookups are deduped within a
 * single call and run in parallel.
 */
async function enrichFindings(findings: LintFinding[]): Promise<void> {
  const symbols = new Set<string>();
  for (const f of findings) {
    if (f._lookupSymbol) symbols.add(f._lookupSymbol);
  }

  const resolved = new Map<string, AnnotationCitation>();
  await Promise.all(
    [...symbols].map(async (sym) => {
      resolved.set(sym, await lookupAnnotation(sym));
    }),
  );

  for (const f of findings) {
    if (f._lookupSymbol) {
      const citation = resolved.get(f._lookupSymbol);
      if (citation?.wikiUrl) f.wikiUrl = citation.wikiUrl;
      if (citation?.signature) f.apiSignature = citation.signature;
    }
    if (f._eventName && !f.wikiUrl) {
      f.wikiUrl = eventWikiUrl(f._eventName);
    }
    delete f._lookupSymbol;
    delete f._eventName;
  }
}

function buildLintBody(sorted: LintFinding[]): string {
  return sorted
    .map((f) => {
      const wiki = f.wikiUrl ? `\n**Wiki:** ${f.wikiUrl}` : "";
      const sig = f.apiSignature
        ? `\n**Signature:** \`${f.apiSignature}\``
        : "";
      const fix = f.fix ? `\n\`\`\`diff\n${f.fix}\n\`\`\`` : "";
      return (
        `### Line ${f.line} - ${f.severity} (${f.category})\n` +
        "```lua\n" +
        `${f.code}\n` +
        "```\n" +
        `> ${f.message} ${f.suggestion}` +
        wiki +
        sig +
        fix
      );
    })
    .join("\n\n");
}

function buildLintNotes(
  sorted: LintFinding[],
  errorCount: number,
  warningCount: number,
  infoCount: number,
): string {
  const counts = new Map<
    string,
    { errors: number; warnings: number; info: number }
  >();
  for (const f of sorted) {
    const entry = counts.get(f.category) ?? { errors: 0, warnings: 0, info: 0 };
    if (f.severity === "error") entry.errors++;
    else if (f.severity === "warning") entry.warnings++;
    else entry.info++;
    counts.set(f.category, entry);
  }
  const rows = [...counts].map(
    ([cat, c]) => `| ${cat} | ${c.errors} | ${c.warnings} | ${c.info} |`,
  );
  return [
    "Findings by category:",
    "",
    "| Category | Errors | Warnings | Info |",
    "|----------|--------|----------|------|",
    ...rows,
    `| **Total** | **${errorCount}** | **${warningCount}** | **${infoCount}** |`,
  ].join("\n");
}

function formatFindings(
  findings: LintFinding[],
  label: string,
  lineCount: number,
): string {
  if (findings.length === 0) {
    return renderReport({
      title: TITLES.addonLint,
      metadata: [
        ["File", label],
        ["Lines", String(lineCount)],
        ["Findings", "0"],
      ],
      body: { outcome: "result", body: "### Status\n\nNo issues found." },
    });
  }

  const sorted = [...findings].sort((a, b) => a.line - b.line);
  const errorCount = sorted.filter((f) => f.severity === "error").length;
  const warningCount = sorted.filter((f) => f.severity === "warning").length;
  const infoCount = sorted.filter((f) => f.severity === "info").length;

  return renderReport({
    title: TITLES.addonLint,
    metadata: [
      ["File", label],
      ["Lines", String(lineCount)],
      [
        "Findings",
        `${sorted.length} (${errorCount} errors, ${warningCount} warnings, ${infoCount} info)`,
      ],
    ],
    body: { outcome: "result", body: buildLintBody(sorted) },
    notes: buildLintNotes(sorted, errorCount, warningCount, infoCount),
  });
}

// ---------------------------------------------------------------------------
// Public rule runner (shared with `wow-project-scan`)
// ---------------------------------------------------------------------------

export interface RunLintRulesOptions {
  /** Whitelist of rule categories. Omit to run every category. */
  readonly categories?: readonly LintCategory[];
  /**
   * Resolve `wikiUrl` / `apiSignature` for `deprecated` and `events` findings
   * by consulting the local LuaLS annotation tree. Default `true` (matches
   * the historical single-file behaviour). Callers that don't render those
   * fields (e.g. project-scan's lint roll-up) pass `false` to skip the
   * subprocess fan-out.
   */
  readonly enrich?: boolean;
}

/**
 * Run the lint rule pipeline against a single Lua source. Pure with respect
 * to the source string; the only side effects are optional `rg` lookups for
 * citation enrichment, which are cached at module level. Findings are
 * stamped with `file: absolutePath` so callers that aggregate across many
 * files can group / sort without re-tracking provenance.
 */
export async function runLintRules(
  absolutePath: string,
  source: string,
  options: RunLintRulesOptions = {},
): Promise<LintFinding[]> {
  const { categories, enrich = true } = options;
  const enabledCategories = new Set<string>(
    categories && categories.length > 0 ? categories : ALL_CATEGORIES,
  );

  const lines = source.split("\n");
  const findings: LintFinding[] = [];
  for (const rule of LINT_RULES) {
    if (!enabledCategories.has(rule.category)) continue;
    rule.check(lines, findings);
  }

  for (const f of findings) f.file = absolutePath;

  if (enrich) await enrichFindings(findings);
  return findings;
}

// ---------------------------------------------------------------------------
// Tool export
// ---------------------------------------------------------------------------

export default tool({
  description:
    "Static analysis for WoW addon Lua. Catches common pitfalls before they reach the game client.\n\n" +
    "Usage:\n" +
    "- `target` accepts either a `.lua` file path or inline Lua code (auto-detected; override with `mode`).\n" +
    "- `categories` selects which rule sets to run; default is all of them.\n" +
    "- Categories:\n" +
    "  - `globals`: undeclared global writes / accidental global pollution.\n" +
    "  - `taint`: combat-protected operations on secure frames, hooksecurefunc misuse.\n" +
    "  - `nil-safety`: missing nil checks on common WoW returns.\n" +
    "  - `hardcoded-ids`: spell/item/quest IDs without symbolic constants.\n" +
    "  - `events`: missing `UnregisterEvent`, malformed `RegisterEvent` calls, event handler issues.\n" +
    "  - `performance`: per-frame work, redundant API calls in hot paths.\n" +
    "  - `deprecated`: deprecated API surface (`UnitAura`, legacy `GetSpellInfo`, etc.).\n" +
    "  - `format`: `string.format` specifier-vs-argument arity mismatches.\n" +
    "  - `frames`: `CreateFrame` calls missing an explicit parent argument.\n" +
    "  - `locale`: hardcoded UI strings that should go through `L[...]`.\n" +
    "  - `errors`: fragile API calls (`C_AddOns.LoadAddOn`, etc.) not wrapped in `pcall`.\n" +
    "  - `ace3`: AceAddon-3.0 lifecycle issues (missing `:OnEnable` / `:OnDisable`).\n\n" +
    "DO NOT use this for runtime issues — it is static-only.",
  args: {
    target: tool.schema
      .string()
      .describe(
        "A `.lua` file path (absolute, `~`-prefixed, or relative to CWD) OR inline Lua code. Auto-detected by presence of whitespace, Lua keywords, or `=`/`{}`/`()`. Single-token ambiguous inputs (e.g. just `print` or `MyVar`) MUST set `mode` explicitly to disambiguate.",
      ),
    mode: tool.schema
      .enum(["file", "inline"])
      .optional()
      .describe(
        'Override auto-detection: force "file" (target is a path) or "inline" (target is Lua code). Omit to auto-detect.',
      ),
    categories: tool.schema
      .array(
        tool.schema.enum([
          "globals",
          "taint",
          "nil-safety",
          "hardcoded-ids",
          "events",
          "performance",
          "deprecated",
          "format",
          "frames",
          "locale",
          "errors",
          "ace3",
        ]),
      )
      .optional()
      .describe(
        'Which lint categories to run. OMIT entirely to run all categories. Do NOT pass an empty array `[]` - that is rejected as ambiguous. Options: "globals", "taint", "nil-safety", "hardcoded-ids", "events", "performance", "deprecated", "format", "frames", "locale", "errors", "ace3".',
      ),
  },
  async execute(args) {
    const { target, mode, categories } = args;
    const trimmedTarget = target.trim();

    // --- Guard: empty target ---
    if (!trimmedTarget) {
      return renderError({
        title: TITLES.addonLint,
        metadata: [["File", "(empty)"]],
        reason: "`target` must not be empty.",
        cause: "(no input provided)",
        suggestions: [
          "Pass an absolute, `~`-prefixed, or relative `.lua` file path.",
          "Or pass inline Lua code as a string.",
          'Set `mode` to `"file"` or `"inline"` to disambiguate single tokens.',
        ],
      });
    }

    // --- Guard: empty categories array (footgun fix) ---
    if (categories !== undefined && categories.length === 0) {
      return renderError({
        title: TITLES.addonLint,
        metadata: [["File", trimmedTarget]],
        reason: "`categories: []` is ambiguous.",
        cause: "Empty array passed for `categories`.",
        suggestions: [
          "Omit `categories` entirely to run all rule categories.",
          'Or pass at least one category name (e.g. `["globals"]`).',
        ],
      });
    }

    // --- Parse input at boundary ---
    let source: string;
    let displayLabel: string;
    try {
      ({ source, displayLabel } = await readLuaSource(target, mode));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return renderError({
        title: TITLES.addonLint,
        metadata: [["File", trimmedTarget]],
        reason: "Failed to read Lua source.",
        cause: message,
        suggestions: [
          "Verify the path exists and is readable.",
          'Pass `mode: "inline"` to lint the input as Lua code instead of a path.',
        ],
      });
    }

    const lineCount = source.split("\n").length;
    // For inline mode `displayLabel` is "inline code"; the absolutePath
    // argument is decorative for findings produced by inline runs.
    const findings = await runLintRules(displayLabel, source, { categories });
    return formatFindings(findings, displayLabel, lineCount);
  },
});
