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

### 2. Implement Against the Philosophy

Not beside it. Not after it. The philosophy defines what correct code looks like. Refactor until compliant - do not ship violations.

### 3. Name What You Checked

Before marking done, explicitly list which laws/pillars your code satisfies. Not "checklist passed" - name them:

- **Code**: Early Exit, Parse Don't Validate, Atomic Predictability, Fail Fast, Intentional Naming
- **Frontend**: Typography, Color, Motion, Composition, Atmosphere
- **Architecture**: Follow the Grain, Layer Direction, Caller-Designed API, Single State Owner, Explicit Failures
- **WoW Addon**: API Lookup Before Use, Event Payload Verification, Taint Avoidance, Nil-Safety on Returns, Lint Before Finalize
- **WoW Frame**: Anchor Hygiene, Strata/Layer Correctness, Secure Frame Guards, Frame Pooling, Backdrop Template Usage

Omitting this step means the task is not done.
