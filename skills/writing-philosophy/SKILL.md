---
name: writing-philosophy
description: The act-of-writing discipline (The 6 Principles of Intentional Writing). Governs how durable documentation is composed - motivation, disclosure, terminology, vocabulary, grounding, and precision.
---

# Writing Philosophy: The 6 Principles of Intentional Writing

**Role:** Discipline for the **act of writing prose about code** - READMEs, guides, references, tutorials, changelogs, design notes.

**Philosophy:** Documentation respects the reader's time. The reader arrived with a question; every paragraph either moves them toward an answer or earns its place by clarifying motivation, defining terminology, or recording a non-obvious fact. Decoration, fabrication, vocabulary drift, and assumed context all push the reader away. The principles below name the failure modes that most often degrade docs and the discipline that prevents them.

## The 6 Principles

### 1. Why Before How
Motivation precedes mechanism. A reader who does not know why a thing exists cannot evaluate whether they need it, and will not retain how it works. Open with the problem, then the shape of the solution, then the details.

### 2. Progressive Disclosure
The fastest path to understanding comes first. Depth is available for readers who want it, but is never the price of admission. A README's first screen should be enough for a reader to decide whether to keep reading.

### 3. Terminology Discipline
One concept, one name, used consistently. If the code calls it a `session`, the docs call it a session - not sometimes a connection and sometimes a context. Synonyms are a tax on the reader.

### 4. Vocabulary Discipline
Every term is interrogated, not inherited. Words copied from source material carry their source's assumptions, and those assumptions may no longer hold. Jargon and acronyms earn their place by appearing more than once and clarifying more than they cost; define a term only if the reader will meet it again. Internal vocabulary from a project's own philosophy documents is not automatically fit for external readers - translate, do not transplant. Metaphors are debt: they feel evocative to the writer and opaque to the reader, so use them only when the literal version is genuinely worse.

### 5. Factual Grounding
Describe what the system does, not what it sounds like it should do. Every claim is checked against the source - code, configuration, existing docs - before it is written down. A plausible-sounding fabrication is worse than an honest gap; when something cannot be verified, say so or leave it out.

### 6. Precision Over Decoration
Short paragraphs, concrete examples, and headings only where they earn their place. Delete sentences that exist to sound thorough. The difference between good and great docs is that great docs respect the reader's time.

---

## Adherence Checklist
Before handing off a document, verify each with a hard yes/no:
- [ ] Does the opening establish why the thing exists before describing how it works?
- [ ] Can a reader make a decision from the first screen, with depth available but not required?
- [ ] Is every concept named with one term, used consistently end-to-end?
- [ ] Have I interrogated every term I borrowed - jargon defined only when reused, internal vocabulary translated for the audience, metaphors only where the literal is worse?
- [ ] Is every non-trivial claim verifiable against the source - and where it is not, did I say so plainly?
- [ ] Does every sentence and heading earn its place, or am I padding to sound thorough?
