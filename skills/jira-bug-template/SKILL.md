---
name: jira-bug-template
description: Jira Bug authoring template — the house style for the Jira authoring agent. Covers the symptom-first noun-phrase title, the bold-labelled body shape (Description / Affected / Expected / Steps to Reproduce / Fix), and Bug-specific anti-patterns.
---

# Jira Bug Template

Bugs use the canonical cluster shape — bold section labels, hyphen-bulleted lists — but Bug-specific section names. The title states what is broken; the body documents reproduction.

## When to use

This skill governs the Jira **Bug** issue type. See `jira-agile-reference` for the full issue hierarchy and decision tree.

- Use **Bug** for an observed regression or defect with a concrete reproducer.
- Use **Task** for planned defect remediation or hardening work where there is no live regression to reproduce.
- Use **Spike** when the cause is unknown and needs investigation before any fix can be scoped.
- Use **Story** when the work changes end-user-observable behavior on purpose (a feature change, not a defect).

Do not use this skill when:

- The reporter cannot describe a reproduction path — open a Spike first.
- The work is enablement or refactor without a defect symptom — that is a Task.

## Scope boundary

This skill produces the body of a single Jira Bug issue ready to submit via the atlassian MCP. It does not transition issues, link issues, or write to other issue types.

## Title Shape

**Symptom-first noun phrase**: states what is wrong, where, with enough specificity that someone reading only the title knows the affected surface. No leading verb.

Acceptable patterns:

- `<component> <symptom> on <surface>` — `Service Catalog Search returns empty result list on staging intake form`
- `<surface> <wrong behavior>` — `Indberet hændelse formular sender forkert tildeling ved natlige incidents`
- `<error code or message>` when the symptom is a known error — `INC<########> duplicate-email triggered by self-cc`

Rules:

- **Never** start with an imperative verb. `Fix Service Catalog Search filter` describes the fix, not the defect.
- Language matches the affected surface. A bug in a Danish form may be authored in Danish; a bug in an English admin script may be authored in English. Mixed is fine when technical names cross languages.
- Length: 6-16 words. Bugs need enough specificity to disambiguate from related defects.

## Body Template

Section labels are bold (`**Label**`). Lists use `-` hyphen bullets. Numbered lines are permitted ONLY under `**Steps to Reproduce**` because reproduction is sequential procedure.

```
**Description**

<one-paragraph: what is wrong, when discovered, who is affected>

**Affected Forms / Surfaces**

- <bullet: specific catalog items, forms, scripts, tables, views>
- <bullet>

**Expected Behavior**

<one-paragraph or bullets describing the correct behavior>

**Steps to Reproduce**

1. <numbered, sequential, concrete>
2. <step>
3. <step>

**Fix**

<one-paragraph or hyphen-bulleted: proposed fix at outcome level, not as code>

**Related**

- <bare DEMO keys, incident IDs (e.g. INC<########>), one per line, no markdown links>
```

Notes on the template:

- All sections except `**Fix**` and `**Related**` are mandatory.
- `**Steps to Reproduce**` is the only section that uses numbered lines — reproduction is sequential procedure, and the order matters for re-running it.
- All other lists use `-` hyphen bullets.
- Body language matches the affected surface; technical names (form labels, system names, table names) are NEVER translated.
- Bugs do not have an `**Acceptance Criteria**` section. The implicit AC is: reproduction no longer reproduces.

## Worked Exemplar

### Exemplar 1 — Constructed bug report

Title: `Service Catalog Search systemliste mangler Manuel Entry-kilde på Indberet hændelse og Bestil adgang formularer`

Body:

```
**Description**

Systemlisten på to catalog item-formularer er filtreret efter discovery source, men kun den automatiske kilde er inkluderet. Manuel Entry-kilden er udeladt, så manuelt oprettede systemer mangler i dropdown'en.

**Affected Forms / Surfaces**

- Indberet hændelse
- Bestil adgang

**Expected Behavior**

Begge formularer skal vise systemer med discovery source Auto Discovery og Manuel Entry, så alle relevante systemer kan vælges.

**Steps to Reproduce**

1. Åbn enten Indberet hændelse eller Bestil adgang
2. Klik i systemlistens dropdown
3. Bemærk at manuelt oprettede systemer mangler

**Fix**

Opdater discovery source-filtret på begge formularer til at inkludere både `Auto Discovery` og `Manuel Entry`.

**Related**

- DEMO-102 (Integration af systemliste i Service Catalog Search)
```

Annotation: Title is symptom-first noun phrase — no leading verb. Body is Danish prose because the affected surface is Danish, but technical names (`Auto Discovery`, `Manuel Entry`) are kept exactly as the system spells them. Section labels are bold and English. `**Steps to Reproduce**` uses numbered lines because order matters; every other list is hyphen-bulleted. `**Fix**` is outcome-level, not code. `**Related**` uses bare keys with parenthesized titles, never markdown links.

## Anti-Patterns

- **Imperative title** (`Fix Service Catalog filter`). The title describes the defect, not the fix.
- **Plain-text section labels** (`Description`, `Affected Forms`). All labels MUST be bold.
- **Markdown headings** (`## Description`) inside Bug body. `**Bold**` labels only.
- **Translating technical names** into the body language. Form names, table names, and field names are kept exactly as the system spells them, regardless of body language.
- **AC section on a Bug.** Bugs use Steps to Reproduce + Expected Behavior + Fix. The implicit AC is: reproduction no longer reproduces.
- **Numbered lists outside Steps to Reproduce.** Hyphen bullets everywhere else.
- **Markdown links in Related.** Bare keys/IDs only — `DEMO-102 (title)`, `INC<########> (title)`, no `[text](url)`.
- **Vague reproduction** ("Sometimes the dropdown is empty"). Every step must be concrete and re-runnable.
- **Code in Fix.** Outcome-level only — name the change, don't paste the implementation.
- **Setting Jira `labels` field or story points.** Never.

## Quick Reference

| Element | Rule |
|---------|------|
| Title format | Symptom-first noun phrase, no leading verb |
| Title length | 6-16 words |
| Mandatory sections | `**Description**`, `**Affected Forms / Surfaces**`, `**Expected Behavior**`, `**Steps to Reproduce**` |
| Optional sections | `**Fix**`, `**Related**` |
| Section labels | English, bold |
| Body prose language | Match the affected surface |
| Steps to Reproduce | Numbered (only section that allows numbers) |
| All other lists | `-` hyphen-bulleted |
| AC | Not used on Bugs (implicit: reproduction no longer reproduces) |
| In-file exemplar | See "Exemplar 1 — Constructed bug report" above |
