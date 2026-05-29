## Code Philosophy - ZERO EXCEPTIONS

**Every code change requires a loaded philosophy. No load, no code. If you already started writing - stop, load it, then resume.**

### 1. Load Before You Touch Code

Pick by task. When in doubt, load both.

| Task                                                                     | Skill to load             |
| ------------------------------------------------------------------------ | ------------------------- |
| React hooks, data transforms, validation, error handling, business logic | `code-philosophy`         |
| Styling, layout, colors, typography, animation, spacing                  | `frontend-philosophy`     |
| System design, new modules, API shape, dependency direction, data flow   | `architecture-philosophy` |
| Component with both logic and visual work                                | Both                      |
| WoW addon Lua code, API calls, events, linting                           | `wow-addon-dev`           |
| WoW frames, widgets, anchoring, textures, animations, secure templates   | `wow-frame-api`           |
| WoW addon with UI work                                                   | Both WoW skills           |

### Agent-Act Discipline

Code-shape philosophies above govern what good code looks like. The skills below govern the act each agent performs - implementing, reviewing, writing prose, researching, bookkeeping. Each agent loads its own act-discipline skill in addition to the code-shape skills relevant to the task.

| Agent               | Act-discipline skill        |
| ------------------- | --------------------------- |
| `software-engineer` | `implementation-philosophy` |
| `reviewer`          | `review-philosophy`         |
| `scribe`            | `writing-philosophy`        |
| `researcher`        | `research-philosophy`       |
| `accountant`        | `accounting-philosophy`     |

### 2. Implement Against the Philosophy

Not beside it. Not after it. The philosophy defines what correct code looks like. Refactor until compliant - do not ship violations.

### 3. Name What You Checked

Before marking done, explicitly list which laws/pillars your code satisfies. Not "checklist passed" - name them:

- **Code**: Early Exit, Parse Don't Validate, Fail Fast, Intentional Naming & Interfaces, Comment Hygiene
- **Frontend**: Typography, Color, Motion, Composition, Atmosphere
- **Architecture**: Follow the Grain, Strict Layer Direction, Justifiable Indirection, Caller-Designed API, Atomic Predictability, Honest Contracts
- **WoW Addon**: API Lookup Before Use, Event Payload Verification, Taint Avoidance, Nil-Safety on Returns, Lint Before Finalize
- **WoW Frame**: Anchor Hygiene, Strata/Layer Correctness, Secure Frame Guards, Frame Pooling, Backdrop Template Usage
- **Act discipline** (per-agent): name the laws/principles from your act-discipline skill - `implementation-philosophy`, `review-philosophy`, `writing-philosophy`, `research-philosophy`, or `accounting-philosophy`.

Omitting this step means the task is not done.
