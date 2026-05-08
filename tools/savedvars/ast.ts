// tools/savedvars/ast.ts
//
// AST shape for the constrained Lua subset emitted by the WoW client when it
// serializes a `SavedVariables` table to disk. The serializer's output is a
// flat sequence of top-level `IDENT = VALUE` statements where every VALUE is
// either a literal scalar or a recursively-nested table constructor.
//
// These types are the canonical form. Once the parser accepts a file, every
// downstream renderer / analyzer operates on `SVValue`, never on the source
// string. (Parse, don't validate.)

export type SVScalar =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "nil"; readonly value: null };

export type SVKey =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number };

export interface SVTable {
  readonly kind: "table";
  readonly entries: ReadonlyArray<{
    readonly key: SVKey;
    readonly value: SVValue;
  }>;
}

export type SVValue = SVScalar | SVTable;

export type SVDocument = ReadonlyMap<string, SVValue>;
