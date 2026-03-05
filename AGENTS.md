# Global Development Rules

Universal rules that apply to every project regardless of language or framework. Project-specific conventions belong in each project's own `AGENTS.md`.

## 🧠 Communication

- **PREFER** concise responses over verbose explanations
- **ALWAYS** explain WHY, not just WHAT, when making architectural decisions
- **ASK** clarifying questions when requirements are ambiguous
- **SUMMARIZE** changes made at the end of each task

## 🏗 Code Quality

- **MUST** keep logic clean and separated - one responsibility per function/module
- **MUST** extract duplicate code into shared helpers
- **MUST** keep functions under 100 lines; extract when longer
- **PREFER** composition over inheritance
- **FOLLOW** existing project patterns and conventions before inventing new ones
- **NEVER** introduce new dependencies without discussing trade-offs
- **AVOID** premature optimization - make it correct first, fast second

## 🔒 Security

- **NEVER** hardcode secrets, credentials, API keys, or tokens in source files
- **NEVER** commit `.env`, `.env.local`, or files containing credentials
- **MUST** use environment variables or secret managers for sensitive values
- **NEVER** log sensitive data (passwords, tokens, PII)

## 🌿 Git Workflow

- **NEVER** work directly on `main` or `master` - always use feature branches
- **MUST** write conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`
- **PREFER** small, atomic commits - each commit should do one thing
- **NEVER** commit code that breaks existing tests
- **MUST** use `gh` CLI for GitHub operations (PRs, issues, etc.)

## 🧪 Testing

- **ALWAYS** run existing tests before and after making changes
- **MUST** write tests for new functionality
- **VERIFY** changes work by running the application when possible
- **ALWAYS** check console output for warnings and errors during runs

## ⚠️ Error Handling

- **MUST** handle errors explicitly - never silently swallow exceptions
- **FOLLOW** the project's established error handling patterns
- **PREFER** specific error types over generic catch-all handlers
- **ALWAYS** include meaningful context in error messages

## 📝 Documentation

- **MUST** update documentation when behavior changes
- **MUST** write docstrings for public APIs and exported functions
- **ONLY** use emojis where appropriate, e.g. in documentation section headers
- **AVOID** the use of `em` and `en`-dashes at all cost - only regular dashes (-) are allowed

## 🎯 Scope Discipline

- **NEVER** make unrelated changes in the same commit or PR
- **MUST** stay focused on the current task - resist scope creep
- **FOLLOW** existing project file structure and organization
- **ASK** before restructuring or reorganizing existing code

## 🔧 Tooling

| Rule                                             | Detail                                          |
|--------------------------------------------------|-------------------------------------------------|
| **PREFER** `ripgrep` (`rg`) over `grep`          | Faster, respects `.gitignore`                   |
| **ALWAYS** use available MCP servers             | Leverage connected tools when they fit the task |
| **NEVER** use `cmd` inside `bash`                | Use the appropriate shell directly              |
| **AVOID** `$` with `pwsh`/`powershell` in `bash` | Causes variable interpolation conflicts         |
