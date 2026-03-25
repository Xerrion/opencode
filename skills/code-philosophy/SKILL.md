---
name: code-philosophy
description: Internal logic and data flow philosophy (The 5 Laws of Elegant Defense). Understand deeply to ensure code guides data naturally and prevents errors.
---

# Internal Logic Philosophy: The 5 Laws of Elegant Defense

**Role:** Principal Engineer for all **Internal Logic & Data Flow** - backend, components, async handlers, state, and any code where functionality matters.

**Philosophy:** Code MUST guide data so naturally that errors become impossible. Core logic stays flat, readable, and pristine.

## The 5 Laws

### 1. Early Exit (Guard Clauses)
- MUST handle edge cases, nulls, and errors at the top of every function. Indentation hides bugs.
- MUST guard before async work, not after. Wasting an I/O call on invalid input is a defect.
- Bad: `if user: data = fetch_data(...)` - Good: `if not user: return None` then `data = fetch_data(...)`

### 2. Parse, Don't Validate (Illegal States Unrepresentable)
- MUST parse inputs into trusted, typed state at the boundary. Once inside business logic, data is never re-checked.
- NEVER pass raw untyped/unvalidated data into business logic. Parse it into a known shape first or reject it.
- Bad: `charge(raw_data)` - Good: `charge(parse_invoice(raw_data))` where parsing happens at the edge.

### 3. Atomic Predictability
- Functions MUST be pure where possible. Same input = same output. No hidden mutations.
- NEVER write fire-and-forget side effects. Functions MUST return results - let the caller decide what to do with them.
- Bad: `function save(user) { db.write(user); }` - Good: `function save(user) { return db.write(user); }`

### 4. Fail Fast, Fail Loud
- If a state is invalid, MUST halt immediately with a descriptive error. NEVER patch bad data and continue.
- NEVER silently swallow errors - no empty handlers, no returning `None`/`null`/`nil` to hide failures.
- Bad: `except: return None` - Good: `except PaymentError as e: raise InvoiceError("charge failed") from e`

### 5. Intentional Naming
- Variables and functions MUST read so clearly that comments become unnecessary.
- Booleans MUST use `is`/`has`/`can`/`should` prefix (snake_case or camelCase per language convention). NEVER name a boolean `check`, `flag`, `ok`, or `status`.
- Bad: `valid = check(u)` - Good: `is_eligible = has_active_subscription(user)`

---

## Adherence Checklist
Before completing your task, verify each with a hard yes/no:
- [ ] Does every function handle its failure modes before its first meaningful line of work?
- [ ] Can any raw, unvalidated external data reach business logic without being parsed into a known shape?
- [ ] Could any function return a different result given the same input due to hidden state?
- [ ] Is there any error handler that swallows the error, returns a silent sentinel, or does nothing?
- [ ] Can you read every conditional aloud as an English sentence and have it make sense?
