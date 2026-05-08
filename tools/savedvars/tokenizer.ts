// tools/savedvars/tokenizer.ts
//
// Hand-rolled tokenizer for the constrained Lua subset emitted by WoW's
// `SavedVariables` serializer. Recognises:
//
//   IDENT, STRING (single+double-quoted with `\n` `\t` `\r` `\"` `\'` `\\`
//   plus `\xHH` and `\ddd` escapes), NUMBER (decimal, hex, optional sign,
//   optional exponent), BOOL (`true`/`false`), NIL (`nil`), and the
//   punctuation `=`, `{`, `}`, `[`, `]`, `,`, `;`.
//
// Skips whitespace and Lua line comments (`--` to end-of-line). Block
// comments (`--[[ ]]`) are intentionally rejected: the WoW client serializer
// does not emit them, and recognising them would invite hand-edited input.

export interface Position {
  readonly line: number;
  readonly col: number;
}

export type Token =
  | ({ readonly kind: "ident"; readonly value: string } & Position)
  | ({ readonly kind: "string"; readonly value: string } & Position)
  | ({ readonly kind: "number"; readonly value: number } & Position)
  | ({ readonly kind: "bool"; readonly value: boolean } & Position)
  | ({ readonly kind: "nil" } & Position)
  | ({
      readonly kind: "punct";
      readonly value: "=" | "{" | "}" | "[" | "]" | "," | ";";
    } & Position);

export class ParseError extends Error {
  readonly line: number;
  readonly col: number;
  constructor(message: string, line: number, col: number) {
    super(`parse error at line ${line}, col ${col}: ${message}`);
    this.name = "ParseError";
    this.line = line;
    this.col = col;
  }
}

interface Cursor {
  src: string;
  pos: number;
  line: number;
  col: number;
}

function makeCursor(source: string): Cursor {
  return { src: source, pos: 0, line: 1, col: 1 };
}

function advance(c: Cursor, n: number): void {
  for (let i = 0; i < n; i++) {
    if (c.src.charCodeAt(c.pos) === 10) {
      c.line++;
      c.col = 1;
    } else {
      c.col++;
    }
    c.pos++;
  }
}

function snapshot(c: Cursor): Position {
  return { line: c.line, col: c.col };
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_REST = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

function skipTrivia(c: Cursor): void {
  while (c.pos < c.src.length) {
    const ch = c.src[c.pos];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance(c, 1);
      continue;
    }
    if (ch === "-" && c.src[c.pos + 1] === "-") {
      if (c.src[c.pos + 2] === "[" && c.src[c.pos + 3] === "[") {
        throw new ParseError(
          "block comments (`--[[ ]]`) are not supported in client-serialized SavedVariables",
          c.line,
          c.col,
        );
      }
      while (c.pos < c.src.length && c.src[c.pos] !== "\n") advance(c, 1);
      continue;
    }
    break;
  }
}

function readIdentOrKeyword(c: Cursor): Token {
  const start = snapshot(c);
  let value = "";
  while (c.pos < c.src.length && IDENT_REST.test(c.src[c.pos])) {
    value += c.src[c.pos];
    advance(c, 1);
  }
  if (value === "true") return { kind: "bool", value: true, ...start };
  if (value === "false") return { kind: "bool", value: false, ...start };
  if (value === "nil") return { kind: "nil", ...start };
  return { kind: "ident", value, ...start };
}

function readString(c: Cursor): Token {
  const start = snapshot(c);
  const quote = c.src[c.pos];
  advance(c, 1);
  let value = "";
  while (c.pos < c.src.length) {
    const ch = c.src[c.pos];
    if (ch === quote) {
      advance(c, 1);
      return { kind: "string", value, ...start };
    }
    if (ch === "\n") {
      throw new ParseError(
        "unterminated string literal (newline before closing quote)",
        start.line,
        start.col,
      );
    }
    if (ch === "\\") {
      value += readEscape(c);
      continue;
    }
    value += ch;
    advance(c, 1);
  }
  throw new ParseError(
    "unterminated string literal (end of input)",
    start.line,
    start.col,
  );
}

function readEscape(c: Cursor): string {
  advance(c, 1); // consume backslash
  if (c.pos >= c.src.length) {
    throw new ParseError("unterminated escape sequence", c.line, c.col);
  }
  const ch = c.src[c.pos];
  // Single-char escapes
  const simple: Record<string, string> = {
    n: "\n",
    t: "\t",
    r: "\r",
    '"': '"',
    "'": "'",
    "\\": "\\",
    a: "\x07",
    b: "\b",
    f: "\f",
    v: "\v",
    "0": "\0",
  };
  if (Object.prototype.hasOwnProperty.call(simple, ch)) {
    advance(c, 1);
    return simple[ch];
  }
  // Hex escape: \xHH
  if (ch === "x") {
    advance(c, 1);
    const h1 = c.src[c.pos];
    const h2 = c.src[c.pos + 1];
    if (!h1 || !h2 || !/[0-9A-Fa-f]/.test(h1) || !/[0-9A-Fa-f]/.test(h2)) {
      throw new ParseError("invalid \\x escape (expected two hex digits)", c.line, c.col);
    }
    advance(c, 2);
    return String.fromCharCode(parseInt(h1 + h2, 16));
  }
  // Decimal escape: \ddd (1-3 digits)
  if (DIGIT.test(ch)) {
    let digits = "";
    while (digits.length < 3 && c.pos < c.src.length && DIGIT.test(c.src[c.pos])) {
      digits += c.src[c.pos];
      advance(c, 1);
    }
    const n = parseInt(digits, 10);
    if (n > 255) {
      throw new ParseError(`invalid decimal escape \\${digits} (>255)`, c.line, c.col);
    }
    return String.fromCharCode(n);
  }
  throw new ParseError(`invalid escape sequence \\${ch}`, c.line, c.col);
}

function readNumber(c: Cursor): Token {
  const start = snapshot(c);
  let raw = "";
  if (c.src[c.pos] === "-" || c.src[c.pos] === "+") {
    raw += c.src[c.pos];
    advance(c, 1);
  }
  // Hex
  if (c.src[c.pos] === "0" && (c.src[c.pos + 1] === "x" || c.src[c.pos + 1] === "X")) {
    raw += c.src[c.pos] + c.src[c.pos + 1];
    advance(c, 2);
    let hex = "";
    while (c.pos < c.src.length && /[0-9A-Fa-f]/.test(c.src[c.pos])) {
      hex += c.src[c.pos];
      advance(c, 1);
    }
    if (hex.length === 0) {
      throw new ParseError("invalid hex literal", start.line, start.col);
    }
    return { kind: "number", value: parseInt(hex, 16) * (raw.startsWith("-") ? -1 : 1), ...start };
  }
  // Decimal (with optional fraction + exponent)
  while (c.pos < c.src.length && DIGIT.test(c.src[c.pos])) {
    raw += c.src[c.pos];
    advance(c, 1);
  }
  if (c.src[c.pos] === ".") {
    raw += ".";
    advance(c, 1);
    while (c.pos < c.src.length && DIGIT.test(c.src[c.pos])) {
      raw += c.src[c.pos];
      advance(c, 1);
    }
  }
  if (c.src[c.pos] === "e" || c.src[c.pos] === "E") {
    raw += c.src[c.pos];
    advance(c, 1);
    if (c.src[c.pos] === "+" || c.src[c.pos] === "-") {
      raw += c.src[c.pos];
      advance(c, 1);
    }
    let exp = "";
    while (c.pos < c.src.length && DIGIT.test(c.src[c.pos])) {
      exp += c.src[c.pos];
      advance(c, 1);
    }
    if (exp.length === 0) {
      throw new ParseError("invalid exponent (no digits)", start.line, start.col);
    }
    raw += exp;
  }
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new ParseError(`invalid number literal "${raw}"`, start.line, start.col);
  }
  return { kind: "number", value, ...start };
}

const PUNCT_SET = new Set(["=", "{", "}", "[", "]", ",", ";"]);

export function tokenize(source: string): Token[] {
  const c = makeCursor(source);
  const tokens: Token[] = [];

  while (true) {
    skipTrivia(c);
    if (c.pos >= c.src.length) break;

    const ch = c.src[c.pos];

    if (ch === '"' || ch === "'") {
      tokens.push(readString(c));
      continue;
    }
    if (DIGIT.test(ch) || (ch === "-" && DIGIT.test(c.src[c.pos + 1] ?? ""))) {
      tokens.push(readNumber(c));
      continue;
    }
    if (IDENT_START.test(ch)) {
      tokens.push(readIdentOrKeyword(c));
      continue;
    }
    if (PUNCT_SET.has(ch)) {
      const start = snapshot(c);
      advance(c, 1);
      tokens.push({
        kind: "punct",
        value: ch as "=" | "{" | "}" | "[" | "]" | "," | ";",
        ...start,
      });
      continue;
    }

    throw new ParseError(`unexpected character ${JSON.stringify(ch)}`, c.line, c.col);
  }

  return tokens;
}
