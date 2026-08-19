# Global Development Rules

Universal rules that apply to every project regardless of language or framework. Project-specific conventions belong in each project's own `AGENTS.md`.

## 🧠 Communication

- **ALWAYS** Use ASD-STE100 Simplified Technical English for all responses
- **PREFER** concise responses over verbose explanations

## 🏗 Code Quality

- **MUST** keep logic clean and separated - one responsibility per function/module
- **PREFER** extracting duplicate code into shared helpers when the duplication is non-trivial
- **PREFER** keeping functions under 100 lines; extract when longer and readability suffers
- **PREFER** composition over inheritance
- **FOLLOW** existing project patterns and conventions before inventing new ones
- **PREFER** evaluating trade-offs before introducing new dependencies

## 🔒 Security

- **NEVER** hardcode secrets, credentials, API keys, or tokens in source files
- **NEVER** commit `.env`, `.env.local`, or files containing credentials
- **MUST** use environment variables or secret managers for sensitive values
- **NEVER** log sensitive data (passwords, tokens, PII)

## 🌿 Git Workflow

- **PREFER** using feature branches over working directly on `main` or `master`
- **PREFER** conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`
- **PREFER** small, atomic commits - each commit should do one thing
- **NEVER** commit code that breaks existing tests
- **MUST** use `gh` CLI for GitHub operations (PRs, issues, etc.)

## 🧪 Testing

- **SHOULD** write tests for new functionality beyond trivial implementations
- **VERIFY** changes work by running the application when possible
- **ALWAYS** check console output for warnings and errors during runs

## 🔎 Delivery and Review

These rules apply to every agent. They apply only when the agent's assigned scope and permissions allow it to make file changes; read-only agents follow them when reviewing or reporting changes made by others.

- **MUST** complete work within the agent's assigned scope and escalate only decisions that require explicit user authority.
- **MUST** self-review every complete diff before requesting external review: re-read changed files, inspect error and security paths, sweep renamed or reshaped references, and confirm verification evidence.
- **MUST** request an independent `reviewer` review after every cycle that writes, edits, creates, moves, or deletes files - including tests, configuration, and documentation. Agents that cannot delegate (no `task` permission) or whose only writes are their own deliverable artefacts (e.g. ADRs under `.deliverables/`) instead **MUST** return the exact changed-file list and self-review evidence to their caller; the orchestrator or user then owns routing the review.
- **MUST NOT** report a file-changing task as complete until `reviewer` returns `APPROVE`, except under the carve-out above, where completion means the changed-file list and evidence were handed to the caller. On `REQUEST_CHANGES`, address every applicable BLOCKER, repeat verification and self-review, then request review again. On `NEEDS_DISCUSSION`, present the concrete decision to the user.
- **MUST** preserve unrelated work in a dirty tree and send the reviewer the exact changed-file list, verification commands and outcomes, plus self-review evidence.

## ⚠️ Error Handling

- **MUST** handle errors explicitly - never silently swallow exceptions
- **FOLLOW** the project's established error handling patterns
- **PREFER** specific error types over generic catch-all handlers
- **ALWAYS** include meaningful context in error messages

## 🔍 Diagnostic Discipline

- **NEVER** open a response with a conclusion header (e.g. `## Yes — X is the cause`, `## Confirmed:`, `## Root cause:`) before running the queries that could falsify it. State the hypothesis as a hypothesis, run disconfirming checks, _then_ state the conclusion.
- **MUST** treat user pushback as evidence. When a user contradicts your current thesis with a factual constraint, drop the thesis and re-derive — do not defend it. Pushback that names a specific fact (a record ID, an email quote, a timestamp, a field value) is data, not opinion.
- **MUST** treat customer-supplied artifacts (emails, tickets, screenshots, logs the user pasted) as primary evidence. Read them before forming a thesis, and re-read them when your thesis stalls. If a customer email names a cause, that is a hypothesis to falsify first, not last.
- **NEVER** adopt a theory before attempting to disconfirm it. List the 2–3 cheapest queries that would prove the theory wrong and run those first. Only escalate to expensive investigation once cheap disconfirmation has failed.
- **MUST** read negative tool results carefully. `total: 0`, empty arrays, and "not found" responses can mean _the thing does not exist_ OR _the search was incomplete_. Check the response envelope for warnings, fallback indicators, or signals that the search was partial before concluding absence.
- **NEVER** interpret an identifier (method name, table name, field name) as a UX label without checking what it actually is in the platform. `deleteAll` may be a Java method that accepts a list of size 1; `processFlow` may be an internal trigger, not a button. Look up the symbol before narrating its behavior.

## 📝 Documentation

- **MUST** update documentation when behavior changes; agents whose scope excludes documentation **MUST** report the needed update to their caller for routing to a docs agent
- **MUST** write docstrings for public APIs and exported functions
- **ONLY** use emojis where appropriate, e.g. in documentation section headers

## 🎯 Scope Discipline

- **NEVER** make unrelated changes in the same commit or PR
- **MUST** stay focused on the current task - resist scope creep
- **FOLLOW** existing project file structure and organization
