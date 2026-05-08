// Curated reference data for known addon libraries. Hand-authored snippets
// representing the canonical idiomatic usage for each library, sourced from
// the library's official documentation. Snippets are presented in tool output
// as "curated examples" — they are NOT extracted from annotation files.
//
// This module establishes `tools/data/` as the home for curated reference
// datasets that augment ripgrep-based lookups. Adding a snippet is a 5-minute
// paste from the library's docs; the match key is the canonical library name
// (matches the annotation filename basename without `.lua`).

export interface LibrarySnippet {
  readonly name: string; // "AceDB-3.0" — canonical, matches filename stem
  readonly description: string; // one line, what this lib gives you
  readonly registration: string; // single-line LibStub/embed call
  readonly example: string; // multi-line Lua, no leading/trailing blank lines
  readonly docsUrl: string; // single canonical docs link
  readonly notes?: string; // one paragraph max — gotchas only
}

export const LIBRARY_SNIPPETS: Readonly<Record<string, Readonly<LibrarySnippet>>> =
  Object.freeze({
    // Empty for v1 — entries authored separately.
  });
