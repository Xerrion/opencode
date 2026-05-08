// tools/savedvars/path.ts
//
// Drill-down path syntax: `MyDB.profiles["Default"].bar` or `MyDB.list[1].name`.
// First segment is a top-level global identifier. Subsequent segments are
// either `.ident` or `[number]` or `[string]`.
//
// Resolution walks the document and returns either the resolved `SVValue`
// or a typed `Unresolved` carrying the failing segment index and reason -
// the renderer uses this to point at exactly which part of the path failed.

import type { SVDocument, SVValue } from "./ast";

export type PathSegment =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number };

export type Resolved = { readonly ok: true; readonly value: SVValue };
export type Unresolved = {
  readonly ok: false;
  readonly at: number;
  readonly reason: "no-such-key" | "scalar-traversal";
};

export class PathSyntaxError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(`invalid path syntax at offset ${offset}: ${message}`);
    this.name = "PathSyntaxError";
    this.offset = offset;
  }
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_REST = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

interface PathCursor {
  src: string;
  pos: number;
}

function readIdent(c: PathCursor): string {
  let v = "";
  while (c.pos < c.src.length && IDENT_REST.test(c.src[c.pos])) {
    v += c.src[c.pos];
    c.pos++;
  }
  return v;
}

function readPathString(c: PathCursor): string {
  const quote = c.src[c.pos];
  const start = c.pos;
  c.pos++;
  let v = "";
  while (c.pos < c.src.length && c.src[c.pos] !== quote) {
    if (c.src[c.pos] === "\\" && c.pos + 1 < c.src.length) {
      const n = c.src[c.pos + 1];
      const map: Record<string, string> = {
        n: "\n",
        t: "\t",
        r: "\r",
        '"': '"',
        "'": "'",
        "\\": "\\",
      };
      if (Object.prototype.hasOwnProperty.call(map, n)) {
        v += map[n];
        c.pos += 2;
        continue;
      }
      throw new PathSyntaxError(`invalid escape \\${n}`, c.pos);
    }
    v += c.src[c.pos];
    c.pos++;
  }
  if (c.pos >= c.src.length) {
    throw new PathSyntaxError("unterminated string", start);
  }
  c.pos++; // consume closing quote
  return v;
}

function readPathNumber(c: PathCursor): number {
  const start = c.pos;
  let raw = "";
  if (c.src[c.pos] === "-") {
    raw += "-";
    c.pos++;
  }
  while (c.pos < c.src.length && DIGIT.test(c.src[c.pos])) {
    raw += c.src[c.pos];
    c.pos++;
  }
  if (raw === "" || raw === "-") {
    throw new PathSyntaxError("expected number", start);
  }
  return parseInt(raw, 10);
}

export function lexPath(input: string): PathSegment[] {
  const c: PathCursor = { src: input.trim(), pos: 0 };
  if (c.src.length === 0) {
    throw new PathSyntaxError("empty path", 0);
  }
  if (!IDENT_START.test(c.src[0])) {
    throw new PathSyntaxError("path must start with an identifier", 0);
  }

  const segments: PathSegment[] = [{ kind: "string", value: readIdent(c) }];

  while (c.pos < c.src.length) {
    const ch = c.src[c.pos];
    if (ch === ".") {
      c.pos++;
      if (c.pos >= c.src.length || !IDENT_START.test(c.src[c.pos])) {
        throw new PathSyntaxError("expected identifier after '.'", c.pos);
      }
      segments.push({ kind: "string", value: readIdent(c) });
      continue;
    }
    if (ch === "[") {
      c.pos++;
      const next = c.src[c.pos];
      if (next === '"' || next === "'") {
        segments.push({ kind: "string", value: readPathString(c) });
      } else if (next === "-" || DIGIT.test(next ?? "")) {
        segments.push({ kind: "number", value: readPathNumber(c) });
      } else {
        throw new PathSyntaxError("expected string or number inside []", c.pos);
      }
      if (c.src[c.pos] !== "]") {
        throw new PathSyntaxError("expected ']'", c.pos);
      }
      c.pos++;
      continue;
    }
    throw new PathSyntaxError(`unexpected character ${JSON.stringify(ch)}`, c.pos);
  }

  return segments;
}

export function resolvePath(
  doc: SVDocument,
  segs: ReadonlyArray<PathSegment>,
): Resolved | Unresolved {
  if (segs.length === 0) {
    return { ok: false, at: 0, reason: "no-such-key" };
  }
  const head = segs[0];
  if (head.kind !== "string") {
    return { ok: false, at: 0, reason: "no-such-key" };
  }
  const root = doc.get(head.value);
  if (root === undefined) {
    return { ok: false, at: 0, reason: "no-such-key" };
  }

  let current: SVValue = root;
  for (let i = 1; i < segs.length; i++) {
    if (current.kind !== "table") {
      return { ok: false, at: i, reason: "scalar-traversal" };
    }
    const seg = segs[i];
    const found = current.entries.find(
      (e) => e.key.kind === seg.kind && e.key.value === seg.value,
    );
    if (!found) {
      return { ok: false, at: i, reason: "no-such-key" };
    }
    current = found.value;
  }
  return { ok: true, value: current };
}

export function formatPath(segs: ReadonlyArray<PathSegment>): string {
  if (segs.length === 0) return "";
  let out = segs[0].kind === "string" ? segs[0].value : `[${segs[0].value}]`;
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind === "number") {
      out += `[${s.value}]`;
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.value)) {
      out += `.${s.value}`;
    } else {
      out += `[${JSON.stringify(s.value)}]`;
    }
  }
  return out;
}
