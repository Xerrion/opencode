# opencode Configuration

This repository contains the global configuration, agent definitions, and specialized skills that govern AI-driven development across all local projects. It defines a personal global baseline for agents, skills, tools, plugins, MCP servers, and permissions.

## 🏗 Repository Structure

- **`AGENTS.md`**: Global rules (Communication, Code Quality, Security, Git Workflow) applying to all agents.
- **`README.md`**: This overview and configuration guide.
- **`opencode.jsonc`**: Shared infrastructure for MCP servers, providers, LSP, plugins, general permission defaults, and disabled inline agents.
- **`dcp.jsonc`**: Schema stub for the Development Communication Protocol plugin.
- **`package.json`**: JS toolchain definitions for custom plugins and tools.
- **`.markdownlint.json`**: Rules for maintaining consistent documentation style.
- **`agents/`**: Specialized agent declarations that co-locate runtime settings, least-privilege permissions, and behavioral contracts.
- **`skills/`**: 24 on-demand knowledge packs for domains like ServiceNow, WoW, and architecture.
- **`commands/`**: 12 slash command definitions for automated pipelines and interactive UIs.
- **`philosophy/`**: Discipline enforcement requiring philosophy loading before any code changes.
- **`plugins/`**: 3 TypeScript plugins providing real-time security guards and instance warnings.
- **`tools/`**: 4 custom tools for World of Warcraft addon development and research.
- **`scripts/`**: Converter that regenerates the GitHub Copilot CLI mirror at `~/.copilot` from this repo.

## 🤖 Agents

Agents operate as either primary orchestrators or specialized subagents. Primary agents can delegate work, while subagents focus on specific technical domains.

There are two enabled entry points for implementation work, and they are alternatives rather than layers. Use `build` when you want the work split across specialists - each delegation lands a verified, self-reviewed commit, and risk decides whether one final `reviewer` loop runs over the completed change set. Use `autonomous-engineer` when you want one agent to own the task end-to-end and delegate only where it helps; it commits per cycle and keeps its mandatory end-of-work review requirement. Use `plan` first when the work needs user sign-off on scope before any of it starts.

File-defined agents own their enablement, runtime settings, and permissions in YAML frontmatter. `opencode.jsonc` retains only inline-only or intentionally disabled inline agents.

| File                  | Mode     | Purpose                                                                                                                                                                                        |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accountant`          | primary  | Personal accounting specialist for Firefly III via the Firefly III and pdf-reader MCPs (disabled)                                                                                              |
| `build`               | primary  | Build orchestrator coordinating implementation via delegation                                                                                                                                  |
| `plan`                | primary  | Planning orchestrator coordinating review via Plannotator                                                                                                                                      |
| `servicenow`          | primary  | ServiceNow platform expert with full MCP access (disabled)                                                                                                                                     |
| `software-engineer`   | subagent | Technical implementation specialist                                                                                                                                                            |
| `autonomous-engineer` | primary  | End-to-end implementation owner with mandatory self-review and independent reviewer approval                                                                                                   |
| `explore`             | subagent | Codebase navigator; read-only chat pointers; no deliverables                                                                                                                                   |
| `researcher`          | subagent | External knowledge gathering                                                                                                                                                                   |
| `red-team`            | subagent | On-demand adversarial security review with PoC-backed findings                                                                                                                                 |
| `reviewer`            | subagent | Read-only code review plus safe refactors                                                                                                                                                      |
| `scribe`              | subagent | Technical writer - READMEs, guides, API refs, changelogs                                                                                                                                       |
| `wow-addon`           | subagent | WoW addon read-only specialist (API/event research, codebase navigation)                                                                                                                       |
| `jira`                | primary  | Jira / Atlassian operator via the Atlassian MCP (disabled)                                                                                                                                     |
| `linear`              | subagent | Linear tracker - records orchestrated work state on delegation (disabled)                                                                                                                      |

## 🧠 Skills

Skills provide deep domain context and are grouped by theme for scannability. They are loaded via the `skill` tool when a task requires specialized knowledge.

### Philosophy

- **`architecture-philosophy`**: The 6 Pillars of Intentional Architecture.
- **`code-philosophy`**: The 5 Laws of Elegant Defense.
- **`frontend-philosophy`**: The 5 Pillars of Intentional UI.

### Agent-Act Discipline

These skills define the discipline an agent applies to its own act of working, orthogonal to the code-shape philosophies above.

- **`implementation-philosophy`**: The 5 Laws of Intentional Implementation (`software-engineer`).
- **`review-philosophy`**: The 5 Laws of Intentional Review (`reviewer`).
- **`writing-philosophy`**: The 6 Principles of Intentional Writing (`scribe`).
- **`research-philosophy`**: The 6 Principles of Intentional Research (`researcher`).
- **`accounting-philosophy`**: The 5 Principles of Intentional Bookkeeping (`accountant`).

### Planning & Review

- **`plan-protocol`**: Guidelines for authoring implementation plans with citations.
- **`plan-review`**: Criteria for reviewing implementation plans.
- **`code-review`**: Methodology with severity classification and confidence thresholds.

### ServiceNow

- **`servicenow-scripting`**: Server-side standards (JavaScript mode, classes, naming, errors, JSDoc).
- **`servicenow-gliderecord`**: GlideRecord and GlideAggregate best practices.
- **`servicenow-encoded-queries`**: Encoded query operators, composition, translation, and safety.
- **`servicenow-business-rules`**: Business Rule timing selection and anti-patterns.
- **`servicenow-client-scripts`**: onChange guards, GlideAjax, and UI Policy patterns.
- **`servicenow-mcp-reference`**: Catalog of 17 supported ServiceNow artifact types.

### World of Warcraft

- **`wow-addon-toolkit`**: Tool-selection precedence and LuaLS API annotation format for WoW addon research.
- **`wow-lua-patterns`**: Idioms for namespaces, SavedVariables, and metatables.
- **`wow-frame-api`**: Frame creation, anchoring, textures, and secure templates.
- **`wow-event-handling`**: Registration, dispatching, and combat lockdown guards.

### Integration

- **`mcp-builder`**: Guide for authoring Python (FastMCP) or Node/TS MCP servers.

## ⚡ Slash Commands

| Command                 | Agent        | Purpose                                                     |
| ----------------------- | ------------ | ----------------------------------------------------------- |
| `/plannotator-annotate` | (inline)     | Interactive annotation UI for a markdown file               |
| `/plannotator-last`     | (inline)     | Annotate the last assistant message                         |
| `/plannotator-review`   | (inline)     | Interactive code review for current changes                 |
| `/review`               | `reviewer`   | Run code review on files or recent changes                  |
| `/sn-debug`             | `servicenow` | Full ServiceNow incident debug pipeline                     |
| `/sn-health`            | `servicenow` | Run the 7 ServiceNow investigation modules                  |
| `/sn-logic-map`         | `servicenow` | Lifecycle logic map of automations on a table               |
| `/sn-review`            | `servicenow` | Code review pipeline for a ServiceNow artifact              |
| `/sn-updateset`         | `servicenow` | Inspect an update set and generate release notes            |
| `/sn-write`             | `servicenow` | Write a ServiceNow script via Development Handover Protocol |
| `/wow-review`           | `wow-addon`  | Code review pipeline for WoW addon Lua                      |
| `/wow-scaffold`         | `wow-addon`  | Scaffold a new WoW addon project                            |

## 🔌 MCP Servers

- **`sonarqube`**: Local Docker (`mcp/sonarqube`) for static analysis.
- **`servicenow`**: Local `servicenow-platform-mcp` accessed via `uv`.
- **`context7`**: Remote library documentation lookup.
- **`exa`**: Remote web search.
- **`gh_grep`**: Remote GitHub code search.
- **`playwright`**: Local headless browser via `@playwright/mcp`.

## 🧩 Plugins

The configuration includes 3 TypeScript plugins to enforce safety and security:

- **`credential-protection.ts`**: Blocks writes/bash/git-stages containing hardcoded credentials; warns on broad `git add`.
- **`sn-credential-protection.ts`**: ServiceNow-specific guard for instance URLs, passwords, and usernames.
- **`sn-production-warning.ts`**: Blocks write operations against production ServiceNow instances.

## 🧰 Custom Tools

Specialized tools for World of Warcraft development:

- **`wow-api-lookup`**: Query local LuaLS annotations for API signatures.
- **`wow-wiki-fetch`**: Fetch documentation from Warcraft wikis.
- **`wow-event-info`**: Parse annotations and wiki links for WoW events.
- **`wow-blizzard-source`**: Browse local Blizzard FrameXML source files.

## ⚙️ How It Works

The system operates through a cascading hierarchy of instructions and targeted context loading.

### 1. Cascading Instructions

When an agent starts a task, it inherits rules from multiple levels:

- **Global**: The root `AGENTS.md` defines universal standards.
- **Agent-Specific**: The agent's declaration defines its unique mode, scope, and constraints.
- **Project-Specific**: Local `AGENTS.md` files (outside this repo) provide project context.

### 2. Philosophy Discipline

To ensure architectural integrity, this configuration enforces a strict philosophy-loading workflow:

- **No Load, No Code**: Agents must load relevant philosophy skills (`code-philosophy`, `frontend-philosophy`, or `architecture-philosophy`) before modifying code.
- **Verification**: Agents must explicitly name which laws or pillars (e.g., Fail Fast, Early Exit, Color, Typography) their code satisfies.

### 3. Specialized Skills

Skills are structured as standalone modules within the `skills/` directory. They provide the "depth" required for specialized tasks without cluttering the global agent prompt.

### 4. Cost-aware discovery

Discovery is proportional to uncertainty, not a mandatory phase. A scoped implementation request goes directly to the implementation agent for targeted reading, even when exact files, symbols, signatures, or tests are not supplied. `explore` is used only to answer a concrete routing, user-facing scope, or implementation-safety question. External research stays focused on authoritative sources for the unresolved fact that affects the decision.

The `build` agent owns these gates and passes pointers forward, so agents do not rediscover the same facts. `explore` stops when it has the decisive path, symbol, caller, test, or dependency fact, or when further exploration is unlikely to change delegation. This reduces unnecessary orchestration without weakening implementation verification.

## 🔐 Permission Model

Safety is enforced through shared defaults and agent-local hard boundaries:

- **Read-only**: Operations are allowed globally for most agents.
- **Restricted**: Shell commands, writes, edits, delegation, and external namespaces require confirmation by default.
- **Co-located profiles**: Each file-defined agent has an explicit least-privilege profile in its own frontmatter.
- **Subagent inheritance**: Shared defaults use `ask`, not `deny`, for capabilities that legitimate descendants need. Agent-local `deny` rules enforce hard role boundaries without creating a global delegation ceiling.
- **Plugin overlay**: Plannotator adds `submit_plan` and its private plan-file edit rules to `plan`; the effective profile is validated after plugins load.
- **Allowlist**: Filesystem access is restricted to the current workspace and the `external_directory` allowlist.

## 📦 Setup / Prerequisites

- **Runtime**: `bun install` for plugins and tools.
- **Environment**: Docker (for SonarQube), `uv`/`uvx` (for ServiceNow MCP), `mise` with Node LTS.
- **Browser**: `npx playwright install chromium` for Playwright MCP.
- **Analysis**: `basedpyright` on PATH for Python LSP.
- **Local Path**: Clone of `servicenow-platform-mcp` at the path specified in `opencode.jsonc`.
- **Plugins**: `@tarquinen/opencode-dcp`, `@franlol/opencode-md-table-formatter`, `@plannotator/opencode`.
- **Secrets**: Env vars `SONARQUBE_*` and `SERVICENOW_ENV`.

## 🛠 Adaptation

To adapt this configuration:

- **Review `AGENTS.md`**: Adjust global rules for communication and quality.
- **Customize Philosophies**: Modify `skills/*-philosophy/` to match your design standards.
- **Refine Permissions**: Adjust shared defaults in `opencode.jsonc` and role-specific permissions in each `agents/*.md` frontmatter.
- **Add Surface**: Extend the configuration with new agents, skills, slash commands, or custom tools.

## 📋 Example Flow

1. **Initialization**: You ask an agent to implement a new UI component.
2. **Context Inheritance**: The agent reads the root `AGENTS.md` and its specific mode in `agents/`.
3. **Philosophy Load**: The agent follows the Prime Directive and loads `code-philosophy` and `frontend-philosophy`.
4. **Execution**: The agent writes the component, applying "Early Exit" for control flow and the "Atmosphere" pillar for visual style.
5. **Verification**: The agent reports completion, listing the principles followed (e.g., "Satisfies: Early Exit, Typography, Atmosphere").
