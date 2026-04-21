# opencode Configuration

This repository contains the global configuration, agent definitions, and specialized skills that govern AI-driven development across all local projects. It provides the rules, tools, and philosophies used by agents to operate consistently and safely.

## 🏗 Repository Structure

- **`AGENTS.md`**: The root authority. Contains the global development rules (Communication, Code Quality, Security, Git Workflow) that apply to every agent in every project.
- **`agents/`**: Declarations for specialized sub-agents (e.g., `coder`, `scribe`, `reviewer`). Each file defines an agent's specific responsibilities, constraints, and operational mode.
- **`skills/`**: On-demand specialized knowledge packs. Skills (like `mcp-builder` or `wow-event-handling`) provide deep domain context and are loaded only when a task requires them.
- **`philosophy/`**: The core logic and architectural standards. This directory includes an `AGENTS.md` that enforces a mandatory "load before code" discipline, ensuring all work aligns with established laws (e.g., The 5 Laws of Elegant Defense).

## ⚙️ How It Works

The system operates through a cascading hierarchy of instructions and targeted context loading.

### 1. Cascading Instructions
When an agent starts a task, it inherits rules from multiple levels:
- **Global**: The root `AGENTS.md` defines universal standards (e.g., "NEVER work directly on main").
- **Agent-Specific**: The agent's own declaration (e.g., `agents/scribe.md`) defines its unique role, scope, and constraints.
- **Project-Specific**: Project-level `AGENTS.md` files (outside this repo) provide local context while respecting global rules.

### 2. The Philosophy Discipline
To prevent unexamined defaults and ensure high-quality output, this configuration enforces a strict philosophy-loading workflow:
- **No Load, No Code**: Agents are required to load relevant philosophy skills before writing or modifying code.
- **Verification**: Before a task is marked complete, agents must explicitly name which laws or pillars (e.g., Early Exit, Parse Don't Validate) their code satisfies.

### 3. Specialized Skills
Skills are structured as standalone modules within the `skills/` directory. Each contains a `SKILL.md` with targeted instructions and may include bundled resources like API references or templates. Agents load these via the `skill` tool when they recognize a task matches a skill's description.

## 🛠 Adaptation

This repository is designed as a personal configuration. To adapt it for your own use:

1. **Review `AGENTS.md`**: Adjust the global rules to match your preferred development workflow and security requirements.
2. **Customize Philosophy**: Modify the files in `skills/*-philosophy/` to reflect your architectural preferences.
3. **Add Skills**: Create new directories in `skills/` for specific technologies or internal platforms you frequently work with.
4. **Refine Agents**: Update the descriptions and constraints in `agents/` to better align with how you delegate tasks.

## 📋 Example Flow

1. **Initialization**: You ask an agent to implement a new data validation utility.
2. **Context Inheritance**: The agent reads the root `AGENTS.md` for global standards and its own declaration in `agents/` for its specific scope.
3. **Philosophy Load**: The agent follows its Prime Directive to select the required skill (e.g., `code-philosophy`) and loads it to satisfy the "load before code" rule in `philosophy/AGENTS.md`.
4. **Execution**: The agent writes the utility, applying "Parse Don't Validate" for input handling and "Early Exit" for edge cases.
5. **Verification**: The agent reports completion, explicitly listing the principles it followed (e.g., "Satisfies: Early Exit, Parse Don't Validate").
