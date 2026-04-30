# opencode plugins

User-level plugins auto-loaded by opencode from this directory.

| Plugin                       | Purpose                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| `credential-protection.ts`   | Blocks file/edit/bash operations that contain hard-coded credentials |
| `sn-credential-protection.ts`| ServiceNow-specific credential guard                                 |
| `sn-production-warning.ts`   | Warns before destructive operations against ServiceNow production    |
| `ralph.ts`                   | Autonomous re-prompting loop (Ralph loop)                            |

---

## ralph.ts — the Ralph loop

A **Ralph loop** is a control pattern where the same agent in the same session is re-prompted automatically at the end of every turn, so it keeps working through a task list until something signals "done." The loop is dumb on purpose: the agent does the thinking, the loop just keeps the wheel turning. Ralph is named after the Wreck-It Ralph "I'm gonna wreck it" energy of an agent that just keeps swinging until told to stop.

### Starting a loop

```text
/ralph                          start on the currently-active agent with the default prompt
/ralph refactor the auth module to use the new session API
                                start on the currently-active agent with an explicit kickoff prompt
```

The loop runs on whichever agent opencode is currently using when you invoke `/ralph`. To run on a different agent, switch agents in opencode first (e.g. select `plan`), then run `/ralph`. The plugin reads the agent off the kickoff user message after the first idle, so there is no agent argument to the slash command.

The slash command's first turn counts as iteration 1. From then on, every `session.idle` triggers iteration N+1 (up to 30 by default).

### Stopping a loop

| Method                       | Who does it      | Effect                                                                  |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `/ralph stop`                | user             | flips loop state inactive; toast confirms                               |
| `.ralph/STOP` sentinel file  | user (or script) | checked on each idle; loop stops and the file is deleted                |
| `<ralph-done reason="..."/>` | model            | emit this marker at the end of any assistant message                    |
| `ralph_stop` tool            | model            | agent-callable tool; takes a `reason` string                            |
| max iterations               | automatic        | hard cap (default 30) prevents runaway cost                             |
| session error                | automatic        | any `session.error` event halts the loop                                |

### Customizing the prompt

Create `.ralph/PROMPT.md` in the working directory. Its contents replace the built-in default prompt that gets sent on every iteration. The token `$ITERATION` is substituted with the current iteration number.

Built-in default:

> Continue the work. Read any plan, todo, or task file in the working directory. Do the next unchecked task. Update the file. If everything is done, end your response with the marker `<ralph-done reason="all tasks complete"/>` and stop.

### Stop-condition reference

Stop conditions are checked in this order on every `session.idle` for an active loop:

1. The agent set a stop reason via the `ralph_stop` tool.
2. `state.iteration >= state.maxIterations` (default 30).
3. `<directory>/.ralph/STOP` exists. The file is deleted after the loop stops.
4. The most recent assistant message contains `<ralph-done reason="..."/>`.

If none of those fire, the plugin re-prompts using the template above.

### Known limitations (v1)

- **State is in-memory.** Restarting opencode kills any active loops with no recovery.
- **Permission prompts pause the loop.** If your config has `edit: ask` or similar, every iteration that touches files will block on a permission dialog.
- **Cost.** Each iteration is a full agent turn — full system prompt, full skill loads, full conversation context. Loops can burn tokens fast. Always set or accept a `maxIterations` you can afford.
- **One loop per session.** The state map is keyed by sessionID; starting a loop in a session that already has one overwrites the old state (and the old loop's next idle becomes the new loop's tick).

User messages typed mid-loop no longer hijack the conversation: the plugin tracks the IDs of every user turn it originates and only re-prompts when the most recent user turn is one of its own. If you type something while the loop is between iterations, your turn is handled normally and the loop resumes on its next own-originated turn.

### Implementation notes

- Hooked events: `command.executed`, `session.idle`, `session.error`, `session.deleted`.
- Custom tool registered: `ralph_stop` (zod-typed args via `tool.schema`).
- All toasts and logs are tagged `ralph` so you can grep `~/.local/share/opencode/log/` for loop activity.
