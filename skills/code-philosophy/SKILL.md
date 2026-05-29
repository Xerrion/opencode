---
name: code-philosophy
description: Internal logic and data flow philosophy (The 5 Laws of Elegant Defense). Understand deeply to ensure code guides data naturally and prevents errors.
---

# Internal Logic Philosophy: The 5 Laws of Elegant Defense

**Role:** Principal Engineer for all **Internal Logic & Data Flow** - backend, components, async handlers, state, and any code where functionality matters.

**Philosophy:** Code MUST guide data so naturally that errors become impossible. Core logic stays flat, readable, and pristine.

> Structural concerns (where state lives, where side effects belong, who owns a module) are governed by `architecture-philosophy`. This skill governs the inside of a function and the shape of a single call site.

## The 5 Laws

### 1. Early Exit (Guard Clauses)
- MUST handle edge cases, nulls, and errors at the top of every function. Indentation hides bugs.
- MUST guard before async work, not after. Wasting an I/O call on invalid input is a defect.
- Bad: `if user: data = fetch_data(...)` - Good: `if not user: return None` then `data = fetch_data(...)`

### 2. Parse, Don't Validate (Illegal States Unrepresentable)
- MUST parse inputs into trusted, typed state at the boundary using a constructor, factory, or schema (e.g. Pydantic, Zod, a typed `from_dict`, an explicit parser function). Casting (`as User`, `<User>raw`, `# type: ignore`) is NOT parsing - it asserts a type without proving it and re-opens the boundary.
- The boundary parser must be the only place that touches the raw shape. Once inside business logic, data is trusted by type and never re-checked.
- NEVER pass raw untyped/unvalidated data into business logic. Parse it into a known shape first or reject it.
- Bad: `charge(raw_data as Invoice)` - Good: `charge(Invoice.parse(raw_data))` where `Invoice.parse` is a real constructor/schema that fails loudly on bad input.

### 3. Fail Fast, Fail Loud
- If a state is invalid, MUST halt immediately with a descriptive error. NEVER patch bad data and continue.
- NEVER silently swallow errors - no empty handlers, no returning `None`/`null`/`nil` to hide failures.
- Bad: `except: return None` - Good: `except PaymentError as e: raise InvoiceError("charge failed") from e`

### 4. Intentional Naming & Interfaces
- Variables and functions MUST read so clearly that comments become unnecessary.
- Booleans MUST use `is`/`has`/`can`/`should` prefix (snake_case or camelCase per language convention). NEVER name a boolean `check`, `flag`, `ok`, or `status`.
- MUST avoid Boolean Blindness at call sites. A call like `createUser("ada", true, false, true)` tells the reader nothing. Use a named options object, keyword arguments, or a small enum so each argument is self-describing at the call site: `createUser("ada", { isAdmin: true, sendInvite: false, requireMFA: true })` or `createUser("ada", Role.Admin, Invite.Skip, MFA.Required)`.
- Bad: `valid = check(u)` - Good: `is_eligible = has_active_subscription(user)`

### 5. Comment Hygiene
- Comments MUST explain WHY (non-obvious tradeoff, constraint, workaround, surprising invariant), NEVER WHAT. If a comment restates the signature or behaviour, delete the comment or rename the code (see Law 4).
- NEVER embed external references in code comments — no ADR numbers, ticket IDs, PR/JIRA links, author names, or dates. That context lives in git history, ADRs, and commit messages; inline references go stale and leak project metadata into source.
- Default to no comment. A comment is justified only when the code cannot be made self-explanatory AND a non-obvious decision must be preserved. Prove the comment is necessary before writing it.
- Docstrings on public/exported APIs describe the contract (inputs, outputs, errors, invariants) — not implementation narration.
- Bad: `// ADR-0001: output-side redactor. Mutates output in place.` - Good: `// Redact on output because input may be re-emitted unchanged by downstream middleware.` (or simpler: delete it entirely if the function name `redactOutput` already carries the meaning - see Law 4.)

---

## Adherence Checklist
Before completing your task, verify each with a hard yes/no:
- [ ] Does every function handle its failure modes before its first meaningful line of work?
- [ ] Can any raw, unvalidated external data reach business logic without being parsed by a constructor, factory, or schema?
- [ ] Is there any error handler that swallows the error, returns a silent sentinel, or does nothing?
- [ ] Can you read every conditional AND function call site aloud and understand what every argument does without looking at the definition?
- [ ] Does every comment explain a non-obvious WHY, with no external references (ADR numbers, ticket IDs, PR links) and no restating of what the code already says?
