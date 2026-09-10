# Global Development Rules

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

## ⚠️ Error Handling

- Handle errors explicitly; never silently swallow an exception. A swallowed error converts an immediate, located failure into a delayed, misattributed one somewhere the cause is no longer visible.
- Follow the project's established error-handling pattern. Mixed patterns mean callers cannot tell from a signature whether failure arrives as a return value, an exception, or a null.
- Prefer specific error types over catch-all handlers. A broad catch also swallows the failures you did not anticipate, which are exactly the ones worth seeing.
- Include meaningful context in error messages - what was attempted, with which input, and what the constraint was. The message is read at 3am by someone without your context.

## 📝 Documentation

- Update documentation when behavior changes. Stale documentation is worse than none, because it is trusted. Agents whose scope excludes documentation report the needed update to their caller for routing to a docs agent.
- Write docstrings for public APIs and exported functions, describing the contract - inputs, outputs, errors, invariants - not the implementation.
- Use emojis only where they aid scanning, such as documentation section headers.

## 🎯 Scope Discipline

- Keep unrelated changes out of the same commit or PR. A mixed diff cannot be reviewed on its merits or reverted cleanly, and reviewers approve the unrelated parts by fatigue rather than by judgement.
- Stay on the current task. Nearby ugliness is real, but fixing it here converts a reviewable change into an unreviewable one. Note it as a follow-up instead.
- Follow the project's existing file structure and organization.
