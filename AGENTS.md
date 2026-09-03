# Global Development Rules

Universal rules that apply to every project regardless of language or framework. Project-specific conventions belong in each project's own `AGENTS.md`.

Absolutes below (`NEVER`, `MUST`) mark boundaries where judgement does not apply - a leaked credential or a knowingly broken test is wrong in every context. Everything else states its reasoning, because a rule you understand transfers to cases the rule did not anticipate, and a rule you merely obey does not.

## 🧠 Communication

- Write in ASD-STE100 Simplified Technical English. Short sentences, one idea each, consistent terms for the same concept. The goal is that a reader can act on the answer without re-reading it.
- Prefer concise responses. Length is not thoroughness; the reader is trying to make a decision, and padding delays it.

## 🏗 Code Quality

- Give each function and module one responsibility. Mixed responsibilities force every future reader to work out which parts of a function apply to their case, and force every test to set up state it does not care about.
- Extract duplicated code into a shared helper when the duplication is non-trivial. Two copies drift; the bug gets fixed in one and reported against the other. Trivial or coincidental repetition is better left alone - premature sharing couples code that only looked similar.
- Treat a function past ~100 lines as a signal to look for a seam, not as a hard limit. Extract when readability actually suffers. One long, linear, well-named sequence beats six helpers that each require a jump to understand.
- Prefer composition over inheritance. Inheritance fixes the relationship at design time and leaks the parent's assumptions into every subclass; composition lets the relationship change without rewriting the hierarchy.
- Follow the project's existing patterns before inventing new ones. A second way of doing something doubles the decisions a reader must make, and the new way rarely displaces the old one.
- Evaluate trade-offs before adding a dependency. Every dependency is a permanent surface for supply-chain risk, version conflicts, and abandonment.

## 🔒 Security

These are absolutes. A leaked secret cannot be un-leaked, and rotation is not always possible.

- **NEVER** hardcode secrets, credentials, API keys, or tokens in source files.
- **NEVER** commit `.env`, `.env.local`, or any file containing credentials.
- **MUST** use environment variables or a secret manager for sensitive values.
- **NEVER** log sensitive data (passwords, tokens, PII). Logs get shipped to third-party aggregators, attached to tickets, and pasted into chat.

## 🌿 Git Workflow

- Work on feature branches rather than directly on `main` or `master`, so unfinished work is never one command away from the default branch.
- Use conventional commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). They let changelogs and version bumps be derived rather than written.
- Keep commits small and atomic - one commit, one thing. The payoff arrives during `git bisect` and during a revert, when a mixed commit forces a choice between keeping a bug and dropping a fix.
- **NEVER** commit code that breaks existing tests. A red default branch blocks everyone, and the cost compounds with every commit layered on top.
- Use the `gh` CLI for GitHub operations (PRs, issues, releases) rather than hand-constructed API calls.

## 🧪 Testing

- Write tests for new functionality beyond trivial implementations. The test is what lets the next person change your code without reading all of it.
- Verify changes by running the application when possible. Passing types and lint prove the code is well-formed, not that it does what was asked.
- Read console output during runs. Warnings are the cheapest defect reports available, and they usually concern the thing you just changed.

## 🔎 Delivery and Review

These rules apply to every agent, but only when the agent's assigned scope and permissions allow file changes. Read-only agents apply them when reviewing or reporting on changes made by others.

The principle underneath all of them: the author is the worst-placed person to judge whether their own change is correct, because they check the code against the same mental model that produced it. Independent review breaks that loop; self-review makes the reviewer's time worth spending.

- **MUST** complete work within the agent's assigned scope, and escalate only decisions that genuinely require user authority.
- **MUST** commit after every implementation cycle - atomic, conventional message - so each cycle is separately revertable and any final review has a clean trail. Push and PR creation wait until required review approves.
- **MUST** self-review the complete diff before committing and before requesting any final review: re-read changed files, inspect error and security paths, sweep renamed or reshaped references, and confirm verification evidence. Self-review and verification are required even when independent review is skipped.
- **MUST** request one independent `reviewer` review when the work is complete, covering the full accumulated change set - code, tests, configuration, and documentation alike. The `build` orchestrator may skip this review only under the narrow, risk-based exception defined in its Review Protocol; uncertainty requires review. Agents that cannot delegate (no `task` permission), or whose only writes are their own deliverable artefacts under `.deliverables/`, instead return the exact changed-file list and self-review evidence to their caller, who then owns routing or documenting the review decision.
- **MUST NOT** report a file-changing task complete until any required final review returns `APPROVE`. When `build` applies its trivial-change exception, it must state why review was skipped and include verification evidence in the final summary. Under the non-delegating carve-out above, completion means the changed-file list and evidence were handed to the caller. On `REQUEST_CHANGES`, address every applicable BLOCKER as new commits, repeat verification and self-review, then request review again. On `NEEDS_DISCUSSION`, put the concrete decision to the user.
- **MUST** preserve unrelated work in a dirty tree, and send the reviewer the exact changed-file list, the verification commands and their outcomes, and self-review evidence. A reviewer guessing at which changes are yours reviews the wrong thing.

## ⚠️ Error Handling

- Handle errors explicitly; never silently swallow an exception. A swallowed error converts an immediate, located failure into a delayed, misattributed one somewhere the cause is no longer visible.
- Follow the project's established error-handling pattern. Mixed patterns mean callers cannot tell from a signature whether failure arrives as a return value, an exception, or a null.
- Prefer specific error types over catch-all handlers. A broad catch also swallows the failures you did not anticipate, which are exactly the ones worth seeing.
- Include meaningful context in error messages - what was attempted, with which input, and what the constraint was. The message is read at 3am by someone without your context.

## 🔍 Diagnostic Discipline

- **NEVER** open a response with a conclusion header (e.g. `## Yes — X is the cause`, `## Confirmed:`, `## Root cause:`) before running the queries that could falsify it. State the hypothesis as a hypothesis, run disconfirming checks, _then_ state the conclusion. A header commits you publicly, and reversing it costs more than never writing it.
- **MUST** treat user pushback as evidence. When a user contradicts your current thesis with a factual constraint, drop the thesis and re-derive — do not defend it. Pushback that names a specific fact (a record ID, an email quote, a timestamp, a field value) is data, not opinion.
- **MUST** treat customer-supplied artifacts (emails, tickets, screenshots, logs the user pasted) as primary evidence. Read them before forming a thesis, and re-read them when your thesis stalls. If a customer email names a cause, that is a hypothesis to falsify first, not last.
- **NEVER** adopt a theory before attempting to disconfirm it. List the 2–3 cheapest queries that would prove the theory wrong and run those first. Only escalate to expensive investigation once cheap disconfirmation has failed.
- **MUST** read negative tool results carefully. `total: 0`, empty arrays, and "not found" responses can mean _the thing does not exist_ OR _the search was incomplete_. Check the response envelope for warnings, fallback indicators, or signals that the search was partial before concluding absence.
- **NEVER** interpret an identifier (method name, table name, field name) as a UX label without checking what it actually is in the platform. `deleteAll` may be a Java method that accepts a list of size 1; `processFlow` may be an internal trigger, not a button. Look up the symbol before narrating its behavior.

## 📝 Documentation

- Update documentation when behavior changes. Stale documentation is worse than none, because it is trusted. Agents whose scope excludes documentation report the needed update to their caller for routing to a docs agent.
- Write docstrings for public APIs and exported functions, describing the contract - inputs, outputs, errors, invariants - not the implementation.
- Use emojis only where they aid scanning, such as documentation section headers.

## 🎯 Scope Discipline

- Keep unrelated changes out of the same commit or PR. A mixed diff cannot be reviewed on its merits or reverted cleanly, and reviewers approve the unrelated parts by fatigue rather than by judgement.
- Stay on the current task. Nearby ugliness is real, but fixing it here converts a reviewable change into an unreviewable one. Note it as a follow-up instead.
- Follow the project's existing file structure and organization.
