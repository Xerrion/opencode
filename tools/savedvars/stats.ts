// tools/savedvars/stats.ts
//
// Single post-order pass that annotates every `SVTable` and top-level value
// with `{ approxBytes, childCount, depth }`. Renderers and anomaly detection
// look up cached stats by reference (WeakMap on tables; primitives recomputed
// cheaply from the value itself).
//
// "Approximate bytes" is source-form, not allocator footprint. The numbers
// are useful for relative ranking ("which subtree dominates this file") not
// absolute accounting; the tool surfaces them as "Approx Bytes".

import type { SVDocument, SVTable, SVValue } from "./ast";

export interface NodeStats {
  readonly approxBytes: number;
  readonly childCount: number;
  readonly depth: number;
}

export interface StatsIndex {
  readonly tables: WeakMap<SVTable, NodeStats>;
  /** Stats for each top-level global, keyed by name. */
  readonly globals: ReadonlyMap<string, NodeStats>;
}

const STRING_OVERHEAD = 2; // surrounding quotes
const NUMBER_BYTES = 12;
const BOOL_BYTES = 5;
const NIL_BYTES = 3;
const TABLE_FRAME = 4; // braces + minimal sep
const ENTRY_OVERHEAD = 2; // ", " between entries
const KEY_BRACKET_OVERHEAD = 4; // "[" + "]" + " = "

function statsForValue(
  value: SVValue,
  cache: WeakMap<SVTable, NodeStats>,
): NodeStats {
  if (value.kind === "string") {
    return { approxBytes: value.value.length + STRING_OVERHEAD, childCount: 0, depth: 1 };
  }
  if (value.kind === "number") {
    return { approxBytes: NUMBER_BYTES, childCount: 0, depth: 1 };
  }
  if (value.kind === "bool") {
    return { approxBytes: BOOL_BYTES, childCount: 0, depth: 1 };
  }
  if (value.kind === "nil") {
    return { approxBytes: NIL_BYTES, childCount: 0, depth: 1 };
  }
  return statsForTable(value, cache);
}

function statsForTable(
  table: SVTable,
  cache: WeakMap<SVTable, NodeStats>,
): NodeStats {
  const cached = cache.get(table);
  if (cached) return cached;

  let bytes = TABLE_FRAME;
  let maxChildDepth = 0;
  for (const { key, value } of table.entries) {
    const keyBytes =
      key.kind === "string"
        ? key.value.length + STRING_OVERHEAD + KEY_BRACKET_OVERHEAD
        : NUMBER_BYTES + KEY_BRACKET_OVERHEAD;
    const childStats = statsForValue(value, cache);
    bytes += keyBytes + childStats.approxBytes + ENTRY_OVERHEAD;
    if (childStats.depth > maxChildDepth) maxChildDepth = childStats.depth;
  }

  const stats: NodeStats = {
    approxBytes: bytes,
    childCount: table.entries.length,
    depth: 1 + maxChildDepth,
  };
  cache.set(table, stats);
  return stats;
}

export function computeStats(doc: SVDocument): StatsIndex {
  const tables = new WeakMap<SVTable, NodeStats>();
  const globals = new Map<string, NodeStats>();
  for (const [name, value] of doc) {
    globals.set(name, statsForValue(value, tables));
  }
  return { tables, globals };
}

export function statsFor(value: SVValue, index: StatsIndex): NodeStats {
  if (value.kind === "table") {
    const cached = index.tables.get(value);
    if (cached) return cached;
    return statsForTable(value, index.tables as WeakMap<SVTable, NodeStats>);
  }
  return statsForValue(value, index.tables as WeakMap<SVTable, NodeStats>);
}
