---
name: jira-task-template
description: Jira Task authoring template — the house style for the Jira authoring agent. Covers imperative title, the canonical Task body (Formål / optional Beskrivelse / Acceptance Criteria), bold section labels, and Task-specific anti-patterns.
---

# Jira Task Template

Tasks are the workhorse issue type in the canonical cluster. They use bold Danish section labels, hyphen-bulleted AC, and follow the strict Formål / Beskrivelse / Acceptance Criteria shape.

## When to use

This skill governs the Jira **Task** issue type. See `jira-agile-reference` for the full hierarchy and decision tree.

- Use **Task** for ceremony, enablement, or technical execution without a direct end-user-observable outcome (build the data model, configure the rule, set the ACL).
- Use **Story** when the work changes end-user-observable behavior or state.
- Use **Spike** when the deliverable is a written investigation rather than execution.
- Use **Bug** when the work is fixing an observed regression with a reproducer.

Do not use this skill when:

- The work delivers a user-observable behavior change — that is a Story.
- The path is unknown and needs investigation first — open a Spike.

## Scope boundary

This skill produces the body of a single Jira Task issue ready to submit via the atlassian MCP. It does not transition issues, link issues, or write to other issue types.

## Title Shape

**Imperative mood**, Danish, verb-first command form ending in `-r`. Tasks are concrete units of execution; imperative reads as a work order.

Examples:

- `Etabler datamodel for Search Query Version`
- `Implementér Business Rules for stamping og versionsstyring`
- `Implementér sikkerhed og immutability`
- `Konfigurér rapportering for søgehits`

Rules:

- Verb-first imperative (`Etabler`, `Implementér`, `Konfigurér`, `Opret`, `Tilføj`, `Fjern`, `Opdater`, `Deploy`).
- **Never** present tense (`Etablerer`, `Implementerer`, `Konfigurerer`).
- Length: 4-10 words.
- Title names the work product, not the activity (`Etabler datamodel`, not `Arbejde med datamodel`).

## Body Template

Section labels are bold (`**Label**`). Lists use `-` hyphen bullets. Bodies are in Danish prose with bold Danish labels (`**Formål**`, `**Beskrivelse**`, `**Acceptance Criteria**` — note the last is in English even though prose is Danish, matching the canonical cluster).

```
**Formål**

<one-line Danish prose>

**Beskrivelse**

<optional Danish prose paragraph(s)>

- <hyphen-bulleted list when implementation detail needs enumerating>
- <bullet>
- <bullet>

**Acceptance Criteria**

- <hyphen-bulleted, declarative, verifiable when this Task is done>
- <bullet>
- <bullet>
```

Rules:

- `**Formål**` is mandatory. One blank line between the label and its content (this is the canonical shape stored by the atlassian MCP — the converter inserts the blank line whether the author writes it or not).
- `**Beskrivelse**` is optional. Include when implementation detail (BR conditions, ACL strategy, field names, sys properties) needs to be recorded. Same one-blank-line rule between label and content. May contain a prose intro followed by a hyphen-bulleted list.
- `**Acceptance Criteria**` is mandatory and English-labelled even when prose is Danish. One blank line between the label and the bullet list.
- All section breaks use a single blank line. Multiple blank lines between sections are normalized away by the atlassian MCP and should not be authored.
- All AC lines are `-` hyphen-bulleted. Declarative passive done-state. Each line must be verifiable when this Task is done.
- AC may use nested indented sub-bullets (six-space indent) when a criterion has sub-items. Example:

```
- Det er afklaret:
      - hvad der skal logges
      - hvor det lagres
      - hvor længe det opbevares
```

## Worked Exemplars

### Exemplar 1 — Task with Beskrivelse (prose intro + bullet list, then AC)

Title: `Implementér Business Rules for stamping og versionsstyring`

Body:

```
**Formål**

Sikre korrekt og historisk konsistent stamping af søgehits samt automatisk håndtering af versioner.

**Beskrivelse**

Implementér Business Rules iht. specifikation, så:

- Intake-formularer får stampet korrekt version og kriterier ved oprettelse
- Versioner håndteres uden overlap
- Data valideres før gem
- Admin advares ved potentielt databrud

**Acceptance Criteria**

- Nye intake-formularer får korrekt stamp ved insert
- Der kan ikke eksistere flere aktive open-ended versioner pr. catalog item
- Ugyldige datoer eller negative værdier kan ikke gemmes
- Sletning af referenced version giver warning
```

This is the canonical full-shape Task: `**Beskrivelse**` carries a prose intro followed by a hyphen-bulleted list, AC then follows with hyphen bullets. One blank line between every bold label and its content.

### Exemplar 2 — Task without Beskrivelse (free prose between Formål and AC)

Title: `Etabler datamodel for Search Query Version`

Body:

```
**Formål**

Klargøre og konfigurere datamodel til versionerede søgehits pr. catalog item.

Repurpose eksisterende custom table og implementér felter, relationer og indexering iht. teknisk design. Datamodellen skal understøtte historik (versionering) og performant opslag ved intake-oprettelse og rapportering.

**Acceptance Criteria**

- Tabellen har label "Search Query Version"
- Versionfelter er oprettet korrekt
- Intake-felter er oprettet korrekt
- Indices er oprettet
- Datamodel matcher teknisk design
```

When the implementation detail is short, omit `**Beskrivelse**` and write the additional prose under `**Formål**` separated by a blank line. The cluster permits this "free prose" shape — it is NOT required to invent a `**Beskrivelse**` section. AC values that contain a quoted string use straight ASCII double quotes.

### Exemplar 3 — Task with backtick-quoted field names in AC

Title: `Implementér sikkerhed og immutability`

Body:

```
**Formål**

Sikre at stampede værdier ikke kan ændres efter oprettelse og at kun autoriserede brugere kan vedligeholde versioner.

**Beskrivelse**

Implementér ACL-strategi iht. design for at opnå defense-in-depth:

- Intake-felter er write-protected efter insert
- Version table kan kun ændres af admin
- Fulfillers kan læse konfigurationen

**Acceptance Criteria**

- `u_search_query` og `u_filter_source` kan ikke ændres efter insert
- Kun admin kan create/write/delete versioner
- itil kan læse versioner
```

Field names and system identifiers in AC are wrapped in single backticks (`` `u_search_query` ``). Role names like `itil` and `admin` are NOT backticked when used as plain English nouns. Backticks signal "this is a literal identifier the system reads."

## Anti-Patterns

- **Plain-text section labels.** `Formål` instead of `**Formål**`. All section labels MUST be bold.
- **Markdown headings inside body.** `## Formål` is wrong. `**Bold**` labels only.
- **Tight Formål spacing** (no blank line between `**Formål**` and its content). The atlassian MCP canonicalizes one blank line between every bold label and its content. Author with the blank line; do not try to defeat the converter.
- **Plain unbulleted AC.** AC is always `-` hyphen-bulleted.
- **Numbered AC.** `1. Nye intake-formularer ...` is wrong. Hyphen bullets only.
- **Translating `**Acceptance Criteria**` to Danish.** The cluster keeps this label in English even with Danish prose.
- **Aspirational AC.** "Solution works well" is unverifiable. Each AC line must be verifiable when this Task is done.
- **DoD-style activity AC.** "Documentation is updated" belongs on the Epic. AC on a Task is what makes THIS Task done.
- **Inventing `**Beskrivelse**` when free prose suffices.** The Exemplar 2 shape (free prose under Formål) is canonical for short Tasks.
- **Setting Jira `labels` field or story points.** Never.
- **Present-tense title verbs.** `Implementerer`, `Konfigurerer` are wrong. Imperative only.
- **Gherkin Given/When/Then.** Not used.

## Quick Reference

| Element | Rule |
|---------|------|
| Title format | Imperative Danish verb-first (`Implementér ...`, `Etabler ...`, `Konfigurér ...`) |
| Title length | 4-10 words |
| `**Formål**` | Mandatory. One blank line between label and content (MCP-canonical) |
| `**Beskrivelse**` | Optional. Include for non-trivial implementation detail |
| `**Acceptance Criteria**` | Mandatory, English-labelled, blank line before bullets |
| AC format | `-` hyphen-bulleted, declarative, verifiable |
| Identifiers in AC | Wrap in single backticks (`` `u_field_name` ``) |
| In-file exemplars | See "Exemplar 1", "Exemplar 2", and "Exemplar 3" above |
