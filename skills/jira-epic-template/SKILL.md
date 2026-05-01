---
name: jira-epic-template
description: Jira Epic authoring template — the house style for the Jira authoring agent. Covers title shape, the canonical body template, mandatory bold section labels, dash hyphen-bullet AC convention, and Epic-specific anti-patterns.
---

# Jira Epic Template

Epics use the canonical cluster shape: bold section labels, hyphen-bulleted lists, bilingual where the work is KR-adjacent.

## When to use

This skill governs the Jira **Epic** issue type. See `jira-agile-reference` for the full hierarchy and decision tree.

- Use **Epic** to group Stories / Tasks / Spikes / Bugs into a delivery theme that does not fit in a single sprint.
- Use **Story** when the work is a single sprint-sized end-user-observable change — do not wrap a single Story in an Epic.
- Use **Task** for ceremony or enablement that does not warrant an Epic-level container.
- Use **Spike** when the deliverable is a written investigation, not a delivery container.

Do not use this skill when:

- Creating an Objective or Initiative — those are out of scope and routed through the OKR owner.
- The work is a single deliverable that fits in a sprint — author it as a Story or Task, not an Epic.

## Scope boundary

This skill produces the body of a single Jira Epic issue ready to submit via the atlassian MCP. It does not transition issues, link Stories to the Epic, or write to other issue types.

## Title Shape

The canonical title shape is `<TAG> – <noun phrase>` with EN-DASH (U+2013, NOT U+002D hyphen-minus, NOT U+2014 em-dash).

- Tag is a stable identifier shared with the OKR/KR layer (`KR1`, `KR2`, `KR3`).
- Noun phrase is in Danish and names the technical Epic's purpose.
- Length: 6-14 words.
- Example (KR-adjacent): `KR1 – Teknisk understøttelse af Service Catalog Search`.

If the Epic is not KR-adjacent, drop the `<TAG> –` prefix and use the noun phrase alone — but the body template is the same.

The tag is the only English fragment in the title. Everything to the right of the en-dash is Danish. Avoid Jira-internal jargon in the noun phrase (`spike`, `refactor`, `cleanup`) — name the outcome, not the activity.

## Body Template

Section labels are bold (`**Label**`). Lists use `-` hyphen bullets. Bodies are written in Danish prose with English section labels (the bilingual hybrid).

```
**Purpose**

<Danish prose explaining the technical purpose, anchored to the business KR or delivery outcome>

**Scope**

- <bullet>
- <bullet>
- <bullet>

**Out of Scope**

- <bullet>
- <bullet>

**Definition of Done**

- <bullet, declarative done-state>
- <bullet>
- <bullet>
```

- All four section labels are mandatory in the order shown.
- One blank line BETWEEN the bold label and the content beneath it.
- Markdown links to context URLs are allowed inside Purpose prose.
- When a Markdown link is followed by a sentence-ending period, leave one space between the closing parenthesis and the period (e.g. `[https://example.com](https://example.com) .`). The atlassian MCP preserves this spacing and it disambiguates the URL from the punctuation in some renderers.
- DoD bullets are declarative and verifiable when the Epic is done — not aspirational.

The Purpose section is prose, not a bulleted list. It typically runs 1-3 short paragraphs and grounds the Epic in either a KR (`understøtter forretnings-EPIC'en for KR1`) or a concrete delivery outcome. When the Epic is KR-adjacent, the second Purpose paragraph should explicitly name the boundary against the business Epic — this is what keeps the Out of Scope list short and uncontroversial. The Scope and Out of Scope lists are deliberately terse — single noun phrases, not full sentences. The Definition of Done is the contract that lets the Epic close: each line should be answerable yes/no by inspection when the work lands.

## Worked Exemplars

### Exemplar 1 — KR-adjacent technical Epic

Title: `KR1 – Teknisk understøttelse af Service Catalog Search`

```
**Purpose**

Etablere den tekniske løsning, der understøtter søgning, filtrering og audit logging af kataloghits på AcmeCorp's interne service catalog.

Epic'en dækker udelukkende den tekniske implementering og understøtter forretnings-EPIC'en for KR1.

**Scope**

- Datamodel for søgehits og filterkriterier
- Indeksering af catalog items i søgeindeks
- Sikring af konsistent data på tværs af staging og prod
- Mulighed for rapportering og audit overblik

**Out of Scope**

- Fastlæggelse af de forretningsmæssige succeskriterier (håndteres i forretnings-EPIC)
- Automatisering af catalog-indhold
- Optimering af brugerrejsen i intake-formularerne

**Definition of Done**

- Service catalog kan søges og filtreres pr. discovery source
- Data kan anvendes direkte i rapportering
- Løsningen er stabil og dokumenteret
- Tekniske valg er afklaret og implementeret
```

This is the canonical shape. Title uses U+2013 en-dash. All four section labels bolded. Lists hyphen-bulleted. The Purpose section opens with an infinitive verb (`Etablere`) — this is the preferred mood. The second Purpose paragraph names the boundary against the business Epic explicitly (`udelukkende den tekniske implementering`). Scope bullets here are 5-8 words each. Definition of Done bullets are similarly terse and each maps to something a reviewer can verify by inspection.

## Anti-Patterns

The patterns below are concrete failure modes. Each one breaks the canonical cluster shape in a way that is mechanically detectable on review.

- **Plain-text section labels** (`Purpose` instead of `**Purpose**`). All section labels MUST be bold.
- **Markdown headings** (`## Purpose`, `### Scope`) inside Epic body. Use `**Bold**` labels only.
- **Unbulleted scope lists.** `Scope`, `Out of Scope`, and `Definition of Done` are always `-` hyphen-bulleted.
- **Hyphen-minus in title separator** (`KR1 - ...`). The separator is U+2013 en-dash (`KR1 – ...`).
- **Em-dash in title separator** (`KR1 — ...`). En-dash, not em-dash.
- **Missing `Out of Scope`.** Required even when short — name the obvious things this Epic does NOT do.
- **Aspirational DoD** (e.g. "Solution works well"). Each DoD line must be verifiable when the Epic is done.
- **Authoring OKR/KR business Epics.** This template is for the technical KR-adjacent Epic; the business Epic is owned by the OKR function.
- **Setting Jira `labels` field or story points.** Never.
- **Present-tense title verbs in the noun phrase.** Epic titles are tagged noun phrases (`KR1 – Teknisk understøttelse ...`), not verb forms. Never use present-tense verbs (`Implementerer`, `Konfigurerer`) anywhere in the title.

## Quick Reference

| Element | Rule |
|---------|------|
| Title format | `<TAG> – <noun phrase>` (en-dash U+2013), 6-14 words, Danish noun phrase |
| KR-adjacent prefix | `KR<N> – ` prefix when the Epic supports a KR; drop the prefix when not KR-adjacent |
| Section labels | `**Bold**`, mandatory four: Purpose, Scope, Out of Scope, Definition of Done |
| Section label language | English |
| Body prose language | Danish |
| Lists | `-` hyphen-bulleted |
| Markdown links | Allowed in Purpose prose for context URLs |
| In-file exemplar | See "Exemplar 1 — KR-adjacent technical Epic" above |
