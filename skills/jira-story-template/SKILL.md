---
name: jira-story-template
description: Jira Story authoring template — the house style for the Jira authoring agent. Covers the imperative deploy-style title, empty-body convention, and Story-specific anti-patterns.
---

# Jira Story Template

Stories in the canonical cluster are minimal: an imperative title and an empty body. The title fully describes the deliverable.

## When to use

This skill governs the Jira **Story** issue type. See `jira-agile-reference` for the full hierarchy and decision tree.

- Use **Story** for a sprint-sized deliverable that changes end-user-observable behavior or state.
- Use **Task** when the work is enablement or ceremony without direct user-observable outcome.
- Use **Spike** when the deliverable is a written investigation rather than a behavior change.
- Use **Bug** when the work is fixing an observed regression with a reproducer.
- Use **Epic** when the work cannot ship in a sprint and groups multiple Stories or Tasks.

Do not use this skill when:

- The work has no end-user-observable outcome — that is a Task.
- The deliverable is a written decision — that is a Spike.

## Scope boundary

This skill produces the body of a single Jira Story issue ready to submit via the atlassian MCP. It does not transition issues, link issues, or write to other issue types.

## Title Shape

**Imperative mood**: verb-first command form, Danish imperative ending in `-r` or English imperative. The title fully describes the deliverable.

Examples:

- `Deploy til staging`
- `Deploy til prod`

Rules:

- Verb-first.
- Length: 3-8 words. Stories are concrete operational steps.

## Body Template

Stories in the canonical cluster have **empty bodies**. The title carries the entire deliverable contract. Do not pad with boilerplate `**Purpose**` / `**Scope**` sections — that is a Task or Epic shape, not a Story.

Rule: default to empty body. The body is only populated when the Story carries non-trivial detail that the title cannot express.

When a body IS needed (rare), follow the same shape as a Task: `**Formål**` then optional `**Beskrivelse**` then `**Acceptance Criteria**` with hyphen-bulleted lines.

```
**Formål**
<one-sentence rationale>

**Beskrivelse**
<optional context>

**Acceptance Criteria**
- <verifiable outcome>
- <verifiable outcome>
```

## Worked Exemplars

### Exemplar 1 — Empty-body Story (staging deploy)

Title: `Deploy til staging`

Body:

```

```

This is the canonical Story shape. The title is the contract. There is nothing else to say — `Deploy til staging` means the artefacts ship to the staging environment and the deploy succeeds. No `**Purpose**`, no AC list, no boilerplate.

### Exemplar 2 — Empty-body Story paired across environments (prod deploy)

Title: `Deploy til prod`

Body:

```

```

Same shape, different environment. Stories pair across environments — one to `staging`, one to `prod` — to make the promotion path explicit at the issue level. Each environment gets its own Story; do not collapse them.

## Anti-Patterns

- **Padding empty Stories with `**Purpose**`/`**Scope**` boilerplate.** When the title is self-describing, the body stays empty.
- **Treating Stories as mini-Epics.** Stories are concrete operational deliverables, not scope containers.
- **Numbered AC.** When a body IS warranted, AC is `-` hyphen-bulleted.
- **Markdown headings in body** (`## Description`). `**Bold**` labels only, never headings.
- **Present-tense title verbs** (`Deployer`, `Implementerer`).
- **Aspirational AC** ("Deploy works well"). When AC is present, every line must be verifiable when the Story is done.
- **Setting Jira `labels` field or story points.** Never.
- **Gherkin Given/When/Then.** Not used in this org.

## Quick Reference

| Element                     | Rule                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Title format                | Imperative verb-first (`Deploy til staging`, `Implementér X`)                        |
| Title length                | 3-8 words                                                                            |
| Body                        | Empty by default. Title is the contract.                                             |
| Body sections (when needed) | `**Formål**`, optional `**Beskrivelse**`, `**Acceptance Criteria**` with `-` bullets |
| AC                          | `-` hyphen-bulleted lines, declarative, verifiable                                   |
| Environment pairing         | One Story per environment (e.g. one for `staging`, one for `prod`)                   |
| In-file exemplars           | See "Exemplar 1" and "Exemplar 2" above                                              |
