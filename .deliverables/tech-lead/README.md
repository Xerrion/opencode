# Tech Lead Deliverables

Durable architecture decisions written by the `tech-lead` agent. Each file in this directory captures one structural decision - the chosen design, the trade-offs, and the implementation path - so engineers and future maintainers can recover the reasoning without re-deriving it.

## Filename convention

```
ADR-NNNN-slug.md
```

- `NNNN` is a zero-padded four-digit sequence number, monotonically increasing.
- `slug` is kebab-case, derived from the design topic, ~6 words max.
- Example: `ADR-0007-event-bus-redesign.md`.

The `tech-lead` agent assigns the next number by scanning this directory and taking `max(existing) + 1`. An empty directory starts at `0001`.

## Lifecycle

ADRs are append-only history. Once written, a file is not deleted or rewritten in place; status changes are recorded by editing the `Status` field in the document header. The full status vocabulary is:

- `Proposed` - the default on creation.
- `Accepted` - the design has been adopted.
- `Rejected` - the design was considered and not adopted. The file is kept on disk as part of the record; it is not deleted.
- `Deprecated` - the design was once accepted but is no longer in force, and no successor ADR replaces it.
- `Superseded by ADR-NNNN` - replaced by a later ADR. The successor is named in the status line.

Superseding an ADR means writing a new one and flipping the old file's status, not removing it.

### Bidirectional supersession

When a new ADR replaces an earlier one, both files are updated:

- The new ADR records `Supersedes: ADR-MMMM` in its header block (and may additionally reference the old one from `More Information`).
- The old ADR's `Status` field is edited to `Superseded by ADR-NNNN`, and a one-line forward link is appended to its body. The old ADR's original prose is otherwise untouched.

### Edit policy

- Typo and clarity edits are allowed in place, no ceremony.
- New material that arrives after acceptance is appended with a dated note (e.g. `**YYYY-MM-DD update:** ...`); the original prose is not rewritten.
- Decision changes are never edited in place - they require writing a new ADR that supersedes the old one.

## Authorship

Only the `tech-lead` agent should add files here. Engineers consume these documents; they do not edit them as part of implementation work.
