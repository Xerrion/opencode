// tools/savedvars/parser.ts
//
// Recursive-descent parser over the token stream produced by `tokenizer.ts`.
// Accepts the constrained Lua subset emitted by WoW's SavedVariables
// serializer:
//
//   document := top_assignment*
//   top_assignment := IDENT "=" value (";" | newline)?
//   value := SCALAR | table
//   table := "{" entry_list? "}"
//   entry_list := entry ("," entry)* ","?  (";" accepted as separator too)
//   entry := value                          // positional (-> numeric key i)
//          | "[" (STRING | NUMBER) "]" "=" value
//          | IDENT "=" value
//
// All positional entries are normalized to explicit numeric keys at parse
// time so downstream code never branches on positional-vs-explicit.

import type { SVDocument, SVKey, SVTable, SVValue } from "./ast";
import { ParseError, type Token } from "./tokenizer";

interface Stream {
  readonly tokens: ReadonlyArray<Token>;
  pos: number;
}

function peek(s: Stream): Token | undefined {
  return s.tokens[s.pos];
}

function consume(s: Stream): Token {
  const tok = s.tokens[s.pos];
  if (!tok) {
    throw new ParseError("unexpected end of input", 0, 0);
  }
  s.pos++;
  return tok;
}

function expectPunct(
  s: Stream,
  value: "=" | "{" | "}" | "[" | "]" | "," | ";",
): Token {
  const tok = peek(s);
  if (!tok || tok.kind !== "punct" || tok.value !== value) {
    const got = tok ? describeToken(tok) : "end of input";
    const at = tok ?? { line: 0, col: 0 };
    throw new ParseError(
      `expected ${JSON.stringify(value)}, got ${got}`,
      at.line,
      at.col,
    );
  }
  s.pos++;
  return tok;
}

function describeToken(tok: Token): string {
  if (tok.kind === "ident") return `identifier ${JSON.stringify(tok.value)}`;
  if (tok.kind === "string") return `string`;
  if (tok.kind === "number") return `number`;
  if (tok.kind === "bool") return `${tok.value}`;
  if (tok.kind === "nil") return `nil`;
  return `${JSON.stringify(tok.value)}`;
}

function parseValue(s: Stream): SVValue {
  const tok = peek(s);
  if (!tok) {
    throw new ParseError("expected value, got end of input", 0, 0);
  }
  if (tok.kind === "string") {
    s.pos++;
    return { kind: "string", value: tok.value };
  }
  if (tok.kind === "number") {
    s.pos++;
    return { kind: "number", value: tok.value };
  }
  if (tok.kind === "bool") {
    s.pos++;
    return { kind: "bool", value: tok.value };
  }
  if (tok.kind === "nil") {
    s.pos++;
    return { kind: "nil", value: null };
  }
  if (tok.kind === "punct" && tok.value === "{") {
    return parseTable(s);
  }
  throw new ParseError(
    `expected value, got ${describeToken(tok)}`,
    tok.line,
    tok.col,
  );
}

function parseTable(s: Stream): SVTable {
  expectPunct(s, "{");
  const entries: { key: SVKey; value: SVValue }[] = [];
  let arrayIndex = 1;

  while (true) {
    const tok = peek(s);
    if (!tok) {
      throw new ParseError("unterminated table (end of input)", 0, 0);
    }
    if (tok.kind === "punct" && tok.value === "}") {
      s.pos++;
      return { kind: "table", entries };
    }

    const entry = parseEntry(s, arrayIndex);
    if (entry.positional) arrayIndex++;
    entries.push({ key: entry.key, value: entry.value });

    const sep = peek(s);
    if (sep && sep.kind === "punct" && (sep.value === "," || sep.value === ";")) {
      s.pos++;
      continue;
    }
    // No separator: must be closing brace next.
    expectPunct(s, "}");
    return { kind: "table", entries };
  }
}

interface ParsedEntry {
  readonly key: SVKey;
  readonly value: SVValue;
  readonly positional: boolean;
}

function parseEntry(s: Stream, arrayIndex: number): ParsedEntry {
  const tok = peek(s);
  if (!tok) {
    throw new ParseError("expected table entry, got end of input", 0, 0);
  }

  // [KEY] = VALUE
  if (tok.kind === "punct" && tok.value === "[") {
    s.pos++;
    const keyTok = consume(s);
    let key: SVKey;
    if (keyTok.kind === "string") {
      key = { kind: "string", value: keyTok.value };
    } else if (keyTok.kind === "number") {
      key = { kind: "number", value: keyTok.value };
    } else {
      throw new ParseError(
        `expected string or number key inside [], got ${describeToken(keyTok)}`,
        keyTok.line,
        keyTok.col,
      );
    }
    expectPunct(s, "]");
    expectPunct(s, "=");
    const value = parseValue(s);
    return { key, value, positional: false };
  }

  // IDENT = VALUE  (shorthand string key)
  if (
    tok.kind === "ident" &&
    s.tokens[s.pos + 1]?.kind === "punct" &&
    (s.tokens[s.pos + 1] as Token & { kind: "punct" }).value === "="
  ) {
    s.pos++;
    expectPunct(s, "=");
    const value = parseValue(s);
    return {
      key: { kind: "string", value: tok.value },
      value,
      positional: false,
    };
  }

  // Positional value -> numeric key.
  const value = parseValue(s);
  return {
    key: { kind: "number", value: arrayIndex },
    value,
    positional: true,
  };
}

export function parseDocument(tokens: ReadonlyArray<Token>): SVDocument {
  const s: Stream = { tokens, pos: 0 };
  const doc = new Map<string, SVValue>();

  while (s.pos < tokens.length) {
    const head = peek(s);
    if (!head) break;
    if (head.kind !== "ident") {
      throw new ParseError(
        `expected top-level identifier, got ${describeToken(head)}`,
        head.line,
        head.col,
      );
    }
    s.pos++;
    expectPunct(s, "=");
    const value = parseValue(s);
    doc.set(head.value, value);

    // Optional `;` separator between top-level assignments.
    const sep = peek(s);
    if (sep && sep.kind === "punct" && sep.value === ";") s.pos++;
  }

  return doc;
}
