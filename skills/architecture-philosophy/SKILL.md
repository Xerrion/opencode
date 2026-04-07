---
name: architecture-philosophy
description: Structural design philosophy (The 5 Laws of Intentional Architecture). Understand deeply to ensure systems grow coherently and stay honest about their dependencies, state, and failure modes.
---

# Architecture Philosophy: The 5 Laws of Intentional Architecture

**Role:** Principal Architect for all **Structural decisions** - module boundaries, dependency direction, API shape, state ownership, and async failure paths.

**Philosophy:** Structure is a promise. Every boundary, dependency, and interface commits the codebase to a shape that is expensive to undo. Make structural choices deliberately, consistently, and honestly.

## The 5 Laws

### 1. Follow the Grain
Never invent new layers, abstractions, or patterns when the codebase already has a home for the concept. Extend the grain - do not cut across it.

On greenfield projects, the first structural choice establishes the grain. Make it deliberately and document it - it becomes the repeatable pattern for everything that follows. Never defer by creating vague catch-all folders (`utils/`, `helpers/`, `misc/`).

- Bad: Adding a third way to manage state in a project that already has two
- Good: Finding the analogous existing module and following its shape

### 2. Strict Layer Direction
Dependencies flow in one direction only: outer layers depend on inner layers, never the reverse. The data layer does not know about the API layer. Business logic does not know about the UI. No circular imports.

- Bad: A repository function importing from a route handler to reuse a type
- Good: Defining shared types in an inner layer that both the route and repository import

### 3. Design APIs for the Caller
Every interface - REST endpoint, function signature, event schema - is designed from the caller's perspective. Implementation details never leak into the public shape. The interface should be stable even if the implementation is completely replaced.

- Bad: Returning a database row object directly as an API response, exposing column names and join artifacts
- Good: Mapping the database result to a caller-facing shape with stable field names

### 4. One Authoritative Source Per State
Every piece of mutable state has exactly one owner. Nothing is synchronized across multiple sources. Derived state is computed, not stored.

- Bad: Storing `isLoading: boolean` alongside `status: "idle" | "loading" | "success" | "error"` - `isLoading` is derived from `status` and will drift
- Good: One `status` field; derive `isLoading` where needed with `status === "loading"`

### 5. Explicit Failure Paths
Every async boundary, queue consumer, and cross-service call has a named, explicit path for failure. Errors surface to an owner who can act - never discarded, never silently retried without a policy.

- Bad: `Promise.all([...])` without a `.catch` or error boundary; a webhook handler that returns 200 regardless of whether processing succeeded
- Good: Every async boundary has a typed error result or a catch that routes the failure to an observable handler

---

## Adherence Checklist
Before completing your task, verify each with a hard yes/no:
- [ ] Is there an existing analogous structure? If yes - was the decision placed there? If no - is the new pattern explicitly defined and repeatable?
- [ ] Can every new import arrow be drawn pointing inward or peer-to-peer? Does any arrow point outward?
- [ ] Could the implementation behind every new interface be swapped out without changing caller code?
- [ ] Does every new piece of state have exactly one owner? Is any derived state stored instead of computed?
- [ ] Does every async boundary have an explicit, named error path that reaches an owner?
