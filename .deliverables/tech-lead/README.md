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

ADRs are append-only history. Once written, a file is not deleted or rewritten in place; status changes are recorded by editing the `Status` field in the document header:

- `Proposed` - the default on creation.
- `Accepted` - the design has been adopted.
- `Superseded` - replaced by a later ADR. Link the successor in the header.

Superseding an ADR means writing a new one and flipping the old file's status, not removing it.

## Authorship

Only the `tech-lead` agent should add files here. Engineers consume these documents; they do not edit them as part of implementation work.
