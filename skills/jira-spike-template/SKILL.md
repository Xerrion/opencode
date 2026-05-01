---
name: jira-spike-template
description: Jira Spike authoring template — the house style for the Jira authoring agent. Covers the imperative Afklar title, the canonical body shape (Purpose / Scope / Acceptance Criteria / Definition of Done), bold section labels, mandatory written-deliverable rule, and Spike-specific anti-patterns.
---

# Jira Spike Template

Spikes deliver a written decision, not running code. They follow the canonical cluster shape: bold English section labels, Danish prose, and AC that names the document.

## When to use

This skill governs the Jira **Spike** issue type. See `jira-agile-reference` for the full hierarchy and decision tree.

- Use **Spike** for time-boxed investigation whose deliverable is a written decision, ADR, comparison matrix, or recommendation document.
- Use **Story** when the work changes end-user-observable behavior — a Spike never ships behavior change.
- Use **Task** when the path is known and the work is execution, not investigation.
- Use **Bug** when the symptom is reproducible and the fix is the deliverable.

Do not use this skill when:

- The deliverable is running code or a configuration change — that is a Story or Task.
- "We'll know it when we see it" is the only acceptance criterion — a Spike must name its written artefact.

## Scope boundary

This skill produces the body of a single Jira Spike issue ready to submit via the atlassian MCP. It does not transition issues, link issues, or write to other issue types.

## Title Shape

**Imperative mood**: `Afklar <emne>` is the canonical pattern. Verb-first command form, Danish.

Example: `Afklar teknisk løsning for Service Catalog Search audit logging`.

Rules:

- Start with `Afklar` (or another imperative `-r` verb when `Afklar` doesn't fit, e.g. `Beslut`, `Vurder`).
- **Never** present tense (`Afklarer`, `Beslutter`, `besluttes`, `aftales`).
- Length: 4-10 words.

## Body Template

Section labels are bold (`**Label**`). Lists use `-` hyphen bullets. Bodies are in Danish prose with bold ENGLISH section labels (matching the canonical bilingual hybrid).

```
**Purpose**

<Danish prose: what decision needs to be made, why now, what does it unblock>

<optional second paragraph for additional framing>

**Scope**

- <hyphen-bulleted: concrete things to evaluate, compare, or document>
- <bullet>
- <bullet>

**Acceptance Criteria**

- <flat declarative done-state, hyphen-bulleted>
- <must include at least one line naming the written deliverable>
- <may use nested indented bullets for sub-points>

**Definition of Done**

- <hyphen-bulleted: downstream completion criteria the Spike unblocks>
- <bullet>
```

Every Spike's `**Acceptance Criteria**` MUST include at least one line naming a tangible written artefact (recommended technical solution document, ADR, decision note, comparison matrix). "Spike is done when we know the answer" is not acceptable AC — name the document.

Additional rules:

- All four section labels (`**Purpose**`, `**Scope**`, `**Acceptance Criteria**`, `**Definition of Done**`) are mandatory in this order on KR-adjacent Spikes.
- One blank line between bold label and the content beneath it.
- AC and DoD play different roles: AC is what makes the Spike itself done; DoD describes the downstream implementation criteria the Spike unblocks. Both are required on KR-adjacent Spikes.

## Worked Exemplars

### Exemplar 1 — KR-adjacent Spike with both AC and DoD

Title: `Afklar teknisk løsning for Service Catalog Search audit logging`

Body:

```
**Purpose**

Afklare og beslutte den tekniske tilgang til, hvordan søgehits og filterkriterier registreres, lagres og stilles til rådighed for audit-rapportering i Service Catalog Search.

Spiken skal sikre, at der er en klar og fælles forståelse af den tekniske løsning, før implementering påbegyndes.

**Scope**

- Datamodel for søgehits pr. catalog item inkl historik (versionering)
- Stempling af søgekriterier på intake-formularen ved oprettelse (audit-sikkert)
- Datavalidering og adgangsstyring, så værdier ikke kan ændres efter oprettelse
- Rapportgrundlag for realiseret audit-dækning (group by created_at)

**Acceptance Criteria**

- Én anbefalet teknisk løsning er valgt
- Alternativer og fravalg er kort dokumenteret
- Det er afklaret:
      - hvordan søgehits registreres
      - hvordan de vedligeholdes
      - hvordan de bruges i rapportering

**Definition of Done**

- Der kan registreres og vedligeholdes søgehits pr. catalog item med historik
- Nye intake-formularer får stamped version og kriterier ved oprettelse
- Stemplede felter er write-protected efter insert (audit-integritet)
- Rapport kan bygges direkte på audit-tabellen og viser månedlig realiseret dækning via created_at
- Løsningen er dokumenteret (datamodel, regler, rapportopsætning, edge cases)
```

Annotation: This is the canonical Spike shape. The AC line `Det er afklaret:` uses six-space indented sub-bullets to enumerate what specifically must be afklaret — this nesting pattern is allowed when the criterion is a parent containing sub-criteria. AC names the deliverable implicitly via `Én anbefalet teknisk løsning er valgt` and `Alternativer og fravalg er kort dokumenteret` — together they require a written recommendation document. DoD lists the downstream system criteria the Spike unblocks. System identifiers like `created_at` are written in plain prose without backticks at the Spike level — backtick wrapping is reserved for Task AC where the identifier is the artefact being changed.

## Anti-Patterns

- **AC without a named or implied written deliverable.** Every Spike must record its decision in a tangible artefact.
- **"Spike is done when we know the answer."** Name the document or its required content.
- **Plain-text section labels.** `Purpose` instead of `**Purpose**`. All section labels MUST be bold.
- **Markdown headings inside Spike body.** `## Purpose` is wrong. `**Bold**` labels only.
- **Plain unbulleted Scope or AC.** Always `-` hyphen-bulleted.
- **Aspirational AC.** "Best path forward is identified" is not verifiable. Use "anbefalet teknisk løsning er valgt", "ADR er skrevet og reviewet."
- **Skipping Definition of Done on KR-adjacent Spikes.** AC + DoD pair is mandatory.
- **Conflating AC and DoD.** AC = Spike done. DoD = downstream system criteria the Spike unblocks.
- **Numbered Scope or AC.** Hyphen bullets only.
- **Present-tense titles.** `Afklarer`, `besluttes`, `aftales` are wrong. Imperative only.
- **Setting Jira `labels` field or story points.** Never.

## Quick Reference

| Element | Rule |
|---------|------|
| Title format | `Afklar <emne>` (or other imperative `-r` verb when `Afklar` doesn't fit) |
| Title length | 4-10 words |
| Mandatory sections | `**Purpose**`, `**Scope**`, `**Acceptance Criteria**`, `**Definition of Done**` |
| Section labels | English, bold |
| Body prose | Danish |
| Lists | `-` hyphen-bulleted |
| Nested AC sub-bullets | Six-space indent for sub-criteria |
| Written deliverable | Mandatory — at least one AC line names or implies it |
| In-file exemplar | See "Exemplar 1 — KR-adjacent Spike with both AC and DoD" above |
