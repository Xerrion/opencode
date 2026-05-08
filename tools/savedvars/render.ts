// tools/savedvars/render.ts
//
// Markdown body renderers for each mode. Output is plain markdown body text
// (no `## Result` heading; the shared report builder owns the H2 schema).
// Every renderer is a pure function over the AST + stats index.

import type { SVDocument, SVKey, SVTable, SVValue } from "./ast";
import { statsFor, type StatsIndex } from "./stats";

const TREE_INDENT = "  ";
const WIDTH_BUDGET = 50; // entries per node before truncation

// ---------------------------------------------------------------------------
// Byte formatting
// ---------------------------------------------------------------------------

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function valueTypeName(v: SVValue): string {
  return v.kind;
}

function formatKey(key: SVKey): string {
  if (key.kind === "number") return `[${key.value}]`;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key.value)) return key.value;
  return `[${escapeLuaString(key.value)}]`;
}

function escapeLuaString(s: string): string {
  return `"${s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

function formatScalar(v: SVValue): string {
  if (v.kind === "string") return escapeLuaString(v.value);
  if (v.kind === "number") return String(v.value);
  if (v.kind === "bool") return v.value ? "true" : "false";
  if (v.kind === "nil") return "nil";
  return "{...}";
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function renderSummary(doc: SVDocument, stats: StatsIndex): string {
  if (doc.size === 0) {
    return "### Top-level Globals\n\n_(none)_";
  }
  const rows: string[] = [
    "### Top-level Globals",
    "",
    "| Name | Type | Children | Depth | Approx Bytes |",
    "|---|---|---|---|---|",
  ];
  const sorted = [...doc.entries()].sort((a, b) => {
    const ba = stats.globals.get(a[0])?.approxBytes ?? 0;
    const bb = stats.globals.get(b[0])?.approxBytes ?? 0;
    return bb - ba;
  });
  for (const [name, value] of sorted) {
    const ns = stats.globals.get(name)!;
    rows.push(
      `| \`${name}\` | ${valueTypeName(value)} | ${ns.childCount} | ${ns.depth} | ${formatBytes(ns.approxBytes)} |`,
    );
  }
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

export function renderTree(
  doc: SVDocument,
  stats: StatsIndex,
  maxDepth: number,
): string {
  if (doc.size === 0) {
    return `### Tree (depth <= ${maxDepth})\n\n_(empty)_`;
  }
  const lines: string[] = [`### Tree (depth <= ${maxDepth})`, "", "```lua"];
  for (const [name, value] of doc) {
    const rendered = renderValueLines(value, stats, maxDepth, 0);
    if (rendered.length === 1) {
      lines.push(`${name} = ${rendered[0]}`);
    } else {
      lines.push(`${name} = ${rendered[0]}`);
      for (let i = 1; i < rendered.length; i++) lines.push(rendered[i]);
    }
  }
  lines.push("```");
  return lines.join("\n");
}

function renderValueLines(
  value: SVValue,
  stats: StatsIndex,
  maxDepth: number,
  currentDepth: number,
): string[] {
  if (value.kind !== "table") {
    return [formatScalar(value)];
  }
  return renderTableLines(value, stats, maxDepth, currentDepth);
}

function renderTableLines(
  table: SVTable,
  stats: StatsIndex,
  maxDepth: number,
  currentDepth: number,
): string[] {
  if (table.entries.length === 0) return ["{}"];

  if (currentDepth >= maxDepth) {
    return [`{ ...(${table.entries.length} keys) }`];
  }

  const indent = TREE_INDENT.repeat(currentDepth + 1);
  const closeIndent = TREE_INDENT.repeat(currentDepth);
  const lines: string[] = ["{"];

  const limit = Math.min(table.entries.length, WIDTH_BUDGET);
  for (let i = 0; i < limit; i++) {
    const { key, value } = table.entries[i];
    const childLines = renderValueLines(value, stats, maxDepth, currentDepth + 1);
    if (childLines.length === 1) {
      lines.push(`${indent}${formatKey(key)} = ${childLines[0]},`);
    } else {
      lines.push(`${indent}${formatKey(key)} = ${childLines[0]}`);
      for (let j = 1; j < childLines.length - 1; j++) lines.push(childLines[j]);
      lines.push(`${childLines[childLines.length - 1]},`);
    }
  }
  if (table.entries.length > WIDTH_BUDGET) {
    lines.push(`${indent}...(${table.entries.length - WIDTH_BUDGET} more)`);
  }
  lines.push(`${closeIndent}}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Value
// ---------------------------------------------------------------------------

export function renderValue(
  value: SVValue,
  stats: StatsIndex,
  pathLabel: string,
  maxDepth: number,
): string {
  const heading = `### Value at \`${pathLabel}\``;
  if (value.kind !== "table") {
    return `${heading}\n\n\`\`\`lua\n${formatScalar(value)}\n\`\`\``;
  }
  const ns = statsFor(value, stats);
  const meta = `_(${ns.childCount} children, depth ${ns.depth}, ${formatBytes(ns.approxBytes)})_`;
  const body = renderTableLines(value, stats, maxDepth, 0).join("\n");
  return `${heading}\n\n${meta}\n\n\`\`\`lua\n${body}\n\`\`\``;
}
