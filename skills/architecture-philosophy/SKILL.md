---
name: architecture-philosophy
description: Structural design philosophy (The Pillars of Intentional Architecture). Understand deeply to ensure systems grow coherently and stay honest about their dependencies, state, and failure modes.
---

# Architecture Philosophy: The Pillars of Intentional Architecture

**Role:** Principal Architect for all **Structural decisions** - module boundaries, dependency direction, API shape, state ownership, and async failure paths.

**Philosophy:** Structure is a promise. Every boundary, dependency, and interface commits the codebase to a shape that is expensive to undo. Make structural choices deliberately, consistently, and honestly.

## The Pillars

### 1. Follow the Grain
Never invent new layers, abstractions, or patterns when the codebase already has a home for the concept. Extend the grain - do not cut across it.

On greenfield projects, the first structural choice establishes the grain. Make it deliberately and document it - it becomes the repeatable pattern for everything that follows. Never defer by creating vague catch-all folders (`utils/`, `helpers/`, `misc/`).

- Bad: Adding a third way to manage state in a project that already has two
- Good: Finding the analogous existing module and following its shape

### 2. Strict Layer Direction
Dependencies flow in one direction only: outer layers depend on inner layers, never the reverse. The data layer does not know about the API layer. Business logic does not know about the UI. No circular imports.

- Bad: A repository function importing from a route handler to reuse a type
- Good: Defining shared types in an inner layer that both the route and repository import

### 3. Justifiable Indirection
Every layer, module, or abstraction must earn its existence by providing a unique transformation, policy enforcement, or complexity isolation. A module that only forwards calls to the next layer down adds cost (an extra file, an extra hop, an extra mock in tests) and zero meaning. Delete passthroughs; introduce a layer only when there is a distinct job for it to do.

- Bad: A `UserService.findById(id)` whose entire body is `return userRepository.find(id)` - the service is a passthrough that exists "in case we need it later"
- Good: Inline the call into the caller (or directly into the repository) until a real policy appears - e.g. "only active users may log in", "audit every read", "fan out to a cache" - and only then introduce the service to hold that policy

Observable check: Does this new module/layer provide a unique transformation, policy, or protection? If it is a passthrough, delete it.

### 4. Design APIs for the Caller
Every interface - REST endpoint, function signature, event schema - is designed from the caller's perspective. Implementation details never leak into the public shape. The interface should be stable even if the implementation is completely replaced.

The API must not leak implementation concepts. Database transactions, ORM entities, framework-specific request/response types, vendor SDK objects, and message-broker envelopes belong inside the implementation. Callers receive plain, caller-shaped values; they never have to import an ORM type, manage a transaction object, or pattern-match on a framework error class.

- Bad: Returning a database row object directly as an API response, exposing column names and join artifacts; accepting a `SQLAlchemy Session` as a parameter so the caller has to know transactions exist
- Good: Mapping the database result to a caller-facing shape with stable field names; the function opens and commits its own transaction internally and returns a domain object

### 5. Atomic Predictability
Side effects have a place, and that place is the edge. Modules in the core MUST be pure by default: same input, same output, no hidden writes, no fire-and-forget I/O. Impurities (database writes, network calls, clock reads, randomness, queue publishes) are pushed outward to a thin, named layer that the caller chooses to invoke. The caller decides when a side effect happens; a deep helper never decides for them.

This is structural, not stylistic: it determines WHERE state-touching code is allowed to live, not just how a single function is written. A pure core with side effects at the edges is testable, reorderable, and honest about cost. A core that mutates whatever it pleases is none of those things.

- Bad: A pricing function in the domain layer that calls `db.write(audit)` and `metrics.increment(...)` as a side effect of computing a price - callers cannot compute a price without committing writes
- Good: The pricing function returns `{ price, auditEvent }`; an outer handler decides whether to persist the audit event and emit the metric

Observable check: Can every core function be called twice with the same input and produce the same return value, with no observable side effect? If not, the side effect belongs further out.

### 6. Honest Contracts
Every interface must be an honest representation of the state and failure modes underneath it. Two obligations follow.

First, **state has one authoritative owner.** No piece of mutable state is duplicated, mirrored, or "kept in sync" across modules, caches, or fields. Derived state is computed, not stored. When two fields claim to describe the same truth, they will drift, and the bug will be blamed on the wrong one.

Second, **failures are part of the contract.** Every async boundary, queue consumer, cross-service call, and fallible operation declares its failure shape - typed errors, result types, named exceptions - and surfaces it to a layer with the context to act. Errors are never silently swallowed in a leaf module, never converted to `null` to flatten a signature, never retried without a policy.

- Bad: A response shape with both `data` and `isError: boolean` as parallel fields (drift waiting to happen); a webhook handler that returns 200 regardless of whether processing succeeded; a repository that catches every exception and returns `null`
- Good: A discriminated union (`{ status: "ok", data } | { status: "error", error }`) where the two states cannot coexist; a handler that returns a typed `Result<T, ProcessingError>` and lets the caller decide retry, dead-letter, or alert

Observable check: Does every interface state both its success shape and its failure shape? Does every piece of mutable state have exactly one owner, with everything else derived?

---

## Adherence Checklist
Before completing your task, verify each with a hard yes/no:
- [ ] Is there an existing analogous structure? If yes - was the decision placed there? If no - is the new pattern explicitly defined and repeatable?
- [ ] Can every new import arrow be drawn pointing inward or peer-to-peer? Does any arrow point outward?
- [ ] Did I delete every passthrough module - any new layer that only forwards to the next one down without adding a transformation, policy, or protection?
- [ ] Could the implementation behind every new interface be swapped out without changing caller code? Does the interface leak any implementation concept (transactions, ORM entities, framework types, vendor SDK objects)?
- [ ] Are side effects pushed to the edges, with the core pure by default and the caller deciding when impurity happens?
- [ ] Does every interface state both its success shape and its failure shape, and does every piece of mutable state have exactly one owner with everything else derived?
