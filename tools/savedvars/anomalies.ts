// tools/savedvars/anomalies.ts
//
// Anomaly detection — surfaces the top-K largest subtrees, deepest paths,
// and very wide arrays. Output is a single string suitable for `## Notes`,
// or `undefined` when nothing is interesting.
//
// Thresholds are deliberately conservative so the section only appears when
// the file genuinely has something worth flagging:
//
//   - Largest subtrees: top 5, only included if `approxBytes > 10%` of file
//   - Deepest paths:    top 5, only included if `depth > 8`
//   - Widest arrays:    top 5 array-shaped tables with >1000 entries

import type { SVDocument, SVTable, SVValue } from "./ast";
import { statsFor, type NodeStats, type StatsIndex } from "./stats";
import { formatBytes } from "./render";

const TOP_K = 5;
const FAT_SUBTREE_FRACTION = 0.1;
const DEEP_THRESHOLD = 8;
const WIDE_ARRAY_THRESHOLD = 1000;

interface Walked {
  readonly path: string;
  readonly value: SVValue;
  readonly stats: NodeStats;
}

function isArrayShaped(table: SVTable): boolean {
  if (table.entries.length === 0) return false;
  for (let i = 0; i < table.entries.length; i++) {
    const k = table.entries[i].key;
    if (k.kind !== "number" || k.value !== i + 1) return false;
  }
  return true;
}

function appendSegment(parent: string, key: SVTable["entries"][number]["key"]): string {
  if (key.kind === "number") return `${parent}[${key.value}]`;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key.value)) return `${parent}.${key.value}`;
  return `${parent}[${JSON.stringify(key.value)}]`;
}

function walkAll(doc: SVDocument, stats: StatsIndex): Walked[] {
  const out: Walked[] = [];
  for (const [name, value] of doc) {
    visit(name, value, stats, out);
  }
  return out;
}

function visit(
  path: string,
  value: SVValue,
  stats: StatsIndex,
  out: Walked[],
): void {
  out.push({ path, value, stats: statsFor(value, stats) });
  if (value.kind !== "table") return;
  for (const { key, value: child } of value.entries) {
    visit(appendSegment(path, key), child, stats, out);
  }
}

function renderLargest(walked: Walked[], fileBytes: number): string | undefined {
  const tables = walked.filter(
    (w) => w.value.kind === "table" && w.stats.approxBytes > fileBytes * FAT_SUBTREE_FRACTION,
  );
  if (tables.length === 0) return undefined;
  const top = [...tables]
    .sort((a, b) => b.stats.approxBytes - a.stats.approxBytes)
    .slice(0, TOP_K);
  const lines = ["**Largest subtrees**"];
  for (const t of top) {
    const pct = ((t.stats.approxBytes / fileBytes) * 100).toFixed(1);
    lines.push(`- \`${t.path}\` -> ${formatBytes(t.stats.approxBytes)} (${pct}% of file)`);
  }
  return lines.join("\n");
}

function renderDeepest(walked: Walked[]): string | undefined {
  const deep = walked.filter(
    (w) => w.value.kind === "table" && w.stats.depth > DEEP_THRESHOLD,
  );
  if (deep.length === 0) return undefined;
  const top = [...deep].sort((a, b) => b.stats.depth - a.stats.depth).slice(0, TOP_K);
  const lines = ["**Deepest paths**"];
  for (const t of top) {
    lines.push(`- \`${t.path}\` -> depth ${t.stats.depth}`);
  }
  return lines.join("\n");
}

function renderWidest(walked: Walked[]): string | undefined {
  const wide = walked.filter(
    (w) =>
      w.value.kind === "table" &&
      isArrayShaped(w.value) &&
      w.value.entries.length > WIDE_ARRAY_THRESHOLD,
  );
  if (wide.length === 0) return undefined;
  const top = [...wide]
    .sort(
      (a, b) =>
        (b.value as SVTable).entries.length - (a.value as SVTable).entries.length,
    )
    .slice(0, TOP_K);
  const lines = ["**Widest arrays**"];
  for (const t of top) {
    lines.push(`- \`${t.path}\` -> ${(t.value as SVTable).entries.length} entries`);
  }
  return lines.join("\n");
}

export function detectAnomalies(
  doc: SVDocument,
  stats: StatsIndex,
  fileBytes: number,
): string | undefined {
  const walked = walkAll(doc, stats);
  const sections = [
    renderLargest(walked, fileBytes),
    renderDeepest(walked),
    renderWidest(walked),
  ].filter((s): s is string => s !== undefined);
  if (sections.length === 0) return undefined;
  return sections.join("\n\n");
}
