// tools/savedvars/toc.ts
//
// Minimal `.toc` directive parser, extracting the SavedVariables and
// SavedVariablesPerCharacter declarations. The TOC format is line-oriented:
//
//   ## Interface: 110000
//   ## Title: My Addon
//   ## SavedVariables: MyAddonDB, MyAddonGlobal
//   ## SavedVariablesPerCharacter: MyAddonCharDB
//
// TODO(wave3-feature1): a more general TOC parser is being added in
// `tools/_toc.ts` as part of `wow-project-scan`. When that lands, migrate
// this module's call sites to consume that module instead and delete this
// file. Kept inline for now so the two features can land independently.

export interface TocSavedVariables {
  readonly account: ReadonlySet<string>;
  readonly perCharacter: ReadonlySet<string>;
}

const DIRECTIVE = /^##\s*([^:]+):\s*(.*)$/;

function splitNames(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}

export function parseTocSavedVariables(content: string): TocSavedVariables {
  const account = new Set<string>();
  const perCharacter = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("##")) continue;
    const m = DIRECTIVE.exec(line);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === "savedvariables") {
      for (const n of splitNames(value)) account.add(n);
    } else if (key === "savedvariablespercharacter") {
      for (const n of splitNames(value)) perCharacter.add(n);
    }
  }

  return { account, perCharacter };
}
