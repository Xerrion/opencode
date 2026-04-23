# opencode Configuration

This repository contains the global configuration, agent definitions, and specialized skills that govern AI-driven development across all local projects. It defines a personal global baseline for agents, skills, tools, plugins, MCP servers, and permissions.

## 🏗 Repository Structure

- **`AGENTS.md`**: Global rules (Communication, Code Quality, Security, Git Workflow) applying to all agents.
- **`README.md`**: This overview and configuration guide.
- **`opencode.jsonc`**: Main configuration for MCP servers, LSP, plugins, permissions, and agent overrides.
- **`dcp.jsonc`**: Schema stub for the Development Communication Protocol plugin.
- **`package.json`**: JS toolchain definitions for custom plugins and tools.
- **`.markdownlint.json`**: Rules for maintaining consistent documentation style.
- **`agents/`**: 17 specialized agent declarations defining modes, roles, and tool access.
- **`skills/`**: 28 on-demand knowledge packs for domains like ServiceNow, WoW, and Security.
- **`command/`**: 12 slash command definitions for automated pipelines and interactive UIs.
- **`philosophy/`**: Discipline enforcement requiring philosophy loading before any code changes.
- **`plugins/`**: 3 TypeScript plugins providing real-time security guards and instance warnings.
- **`tools/`**: 5 custom tools for World of Warcraft addon development and research.
- **`docs/`**: Supporting documentation and demonstrations.

## 🤖 Agents

Agents operate as either primary orchestrators or specialized subagents. Primary agents can delegate work, while subagents focus on specific technical domains.

| File | Mode | Purpose |
|---|---|---|
| `build` | primary | Build orchestrator coordinating implementation via delegation |
| `plan` | primary | Planning orchestrator coordinating review via Plannotator |
| `servicenow` | primary | ServiceNow platform expert with full MCP access |
| `ai-redteam` | subagent | AI/LLM red-team - prompt injection, jailbreaks, tool-call abuse |
| `coder` | subagent | Technical implementation specialist |
| `debugger` | subagent | Read-only diagnostician producing repro + root-cause reports |
| `explore` | subagent | Fast read-only codebase navigator |
| `git` | subagent | Git/GitHub operations via `git` and `gh` |
| `jira-coach` | subagent | Jira authoring via atlassian MCP (TV2 style) |
| `pentest` | subagent | Offensive security - SAST, DAST, supply-chain, IaC |
| `researcher` | subagent | External knowledge gathering |
| `reverse-engineer` | subagent | RE across binaries, mobile, JS/WASM, firmware, malware |
| `reviewer` | subagent | Read-only code review plus safe refactors |
| `scribe` | subagent | Technical writer - READMEs, guides, API refs, changelogs |
| `servicenow-dev` | subagent | ServiceNow script developer (Business Rules, Script Includes) |
| `tester` | subagent | Writes/maintains tests, runs suites |
| `wow-addon` | subagent | WoW addon domain expert, read-only research |

## 🧠 Skills

Skills provide deep domain context and are grouped by theme for scannability. They are loaded via the `skill` tool when a task requires specialized knowledge.

### Philosophy
- **`architecture-philosophy`**: The 5 Laws of Intentional Architecture.
- **`code-philosophy`**: The 5 Laws of Elegant Defense.
- **`frontend-philosophy`**: The 5 Pillars of Intentional UI.

### Planning & Review
- **`plan-protocol`**: Guidelines for authoring implementation plans with citations.
- **`plan-review`**: Criteria for reviewing implementation plans.
- **`code-review`**: Methodology with severity classification and confidence thresholds.

### ServiceNow
- **`servicenow-scripting`**: Server-side standards (classes, naming, errors, JSDoc).
- **`servicenow-gliderecord`**: GlideRecord and GlideAggregate best practices.
- **`servicenow-business-rules`**: Business Rule timing selection and anti-patterns.
- **`servicenow-client-scripts`**: onChange guards, GlideAjax, and UI Policy patterns.
- **`servicenow-mcp-reference`**: Catalog of 17 supported ServiceNow artifact types.
- **`servicenow-scriptsync`**: Integration for managing local ServiceNow script files.

### World of Warcraft
- **`wow-addon-dev`**: Addon development with LuaLS API annotations.
- **`wow-lua-patterns`**: Idioms for namespaces, SavedVariables, and metatables.
- **`wow-frame-api`**: Frame creation, anchoring, textures, and secure templates.
- **`wow-event-handling`**: Registration, dispatching, and combat lockdown guards.

### Pentest & Security
- **`pentest-methodology`**: Engagement lifecycle, `.pentest/` layout, and severity rubric.
- **`pentest-sast`**: SAST, dependency, secret, and supply-chain scanning.
- **`pentest-dast`**: DAST, infrastructure, authentication, and container testing.
- **`pentest-ai-redteam`**: AI/LLM red-team playbook (injection, leakage, tool abuse).

### Reverse Engineering
- **`rev-methodology`**: Engagement lifecycle and `.rev/` directory layout.
- **`rev-static`**: Analysis across native, managed, JavaScript, and WebAssembly.
- **`rev-dynamic`**: Sandbox execution, debugging, tracing, and Frida instrumentation.
- **`rev-mobile`**: Android (apktool/jadx) and iOS (class-dump/frida) workflows.
- **`rev-firmware`**: Extraction, filesystem analysis, and hardware emulation.
- **`rev-malware`**: Triage, YARA/Sigma rule authoring, and IoC extraction.

### Integration
- **`jira-agile-reference`**: Jira MCP catalog and TV2 tenant agile authoring.
- **`mcp-builder`**: Guide for authoring Python (FastMCP) or Node/TS MCP servers.

## ⚡ Slash Commands

| Command | Agent | Purpose |
|---|---|---|
| `/plannotator-annotate` | (inline) | Interactive annotation UI for a markdown file |
| `/plannotator-last` | (inline) | Annotate the last assistant message |
| `/plannotator-review` | (inline) | Interactive code review for current changes |
| `/review` | `reviewer` | Run code review on files or recent changes |
| `/sn-debug` | `servicenow` | Full ServiceNow incident debug pipeline |
| `/sn-health` | `servicenow` | Run the 7 ServiceNow investigation modules |
| `/sn-logic-map` | `servicenow` | Lifecycle logic map of automations on a table |
| `/sn-review` | `servicenow` | Code review pipeline for a ServiceNow artifact |
| `/sn-updateset` | `servicenow` | Inspect an update set and generate release notes |
| `/sn-write` | `servicenow` | Write a ServiceNow script via Development Handover Protocol |
| `/wow-review` | `wow-addon` | Code review pipeline for WoW addon Lua |
| `/wow-scaffold` | `wow-addon` | Scaffold a new WoW addon project |

## 🔌 MCP Servers

- **`sonarqube`**: Local Docker (`mcp/sonarqube`) for static analysis.
- **`servicenow`**: Local `servicenow-platform-mcp` accessed via `uv`.
- **`context7`**: Remote library documentation lookup.
- **`exa`**: Remote web search.
- **`gh_grep`**: Remote GitHub code search.
- **`playwright`**: Local headless browser via `@playwright/mcp`.
- **`atlassian`**: Local `uvx mcp-atlassian` with a fail-loud environment guard.

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
- **`wow-addon-lint`**: Custom static analysis rules for WoW Lua code.

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

## 🔐 Permission Model

Safety is enforced through a restricted permission baseline:
- **Read-only**: Operations are allowed globally for most agents.
- **Restricted**: Writes, edits, destructive bash commands, and MCP tools are denied by default.
- **Opt-in**: Each agent explicitly opts in to the tools it needs via per-agent overrides in `opencode.jsonc`.
- **Allowlist**: Filesystem access is restricted to the current workspace and the `external_directory` allowlist.

## 📦 Setup / Prerequisites

- **Runtime**: `bun install` for plugins and tools.
- **Environment**: Docker (for SonarQube), `uv`/`uvx` (for Atlassian and ServiceNow MCP), `mise` with Node LTS.
- **Browser**: `npx playwright install chromium` for Playwright MCP.
- **Analysis**: `basedpyright` on PATH for Python LSP.
- **Local Path**: Clone of `servicenow-platform-mcp` at the path specified in `opencode.jsonc`.
- **Plugins**: `@tarquinen/opencode-dcp`, `@franlol/opencode-md-table-formatter`, `@plannotator/opencode`.
- **Secrets**: Env vars `SONARQUBE_*`, `ATLASSIAN_URL_BASE`, `ATLASSIAN_USERNAME`, `ATLASSIAN_API_TOKEN`, and `SERVICENOW_ENV`.

## 🛠 Adaptation

To adapt this configuration:
- **Review `AGENTS.md`**: Adjust global rules for communication and quality.
- **Customize Philosophies**: Modify `skills/*-philosophy/` to match your design standards.
- **Refine Permissions**: Adjust the `opencode.jsonc` security baseline and agent-specific tool overrides.
- **Add Surface**: Extend the configuration with new agents, skills, slash commands, or custom tools.

## 📋 Example Flow

1. **Initialization**: You ask an agent to implement a new UI component.
2. **Context Inheritance**: The agent reads the root `AGENTS.md` and its specific mode in `agents/`.
3. **Philosophy Load**: The agent follows the Prime Directive and loads `code-philosophy` and `frontend-philosophy`.
4. **Execution**: The agent writes the component, applying "Atomic Predictability" for state and the "Atmosphere" pillar for visual style.
5. **Verification**: The agent reports completion, listing the principles followed (e.g., "Satisfies: Atomic Predictability, Typography, Atmosphere").
