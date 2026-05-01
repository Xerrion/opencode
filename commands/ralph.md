---
description: Start or stop a Ralph autonomous loop. Usage `/ralph [prompt]` or `/ralph stop`.
---

You are running inside a Ralph autonomous loop. The plugin will re-prompt you on each `session.idle` until a stop condition is met.

The loop runs on whichever agent is currently active in opencode. If you want a different agent, switch agents first, then run `/ralph`.

User arguments (may be empty, may be `stop`, or may contain a starting prompt):

$ARGUMENTS

If the arguments are non-empty and not the word `stop`, treat them as your initial task. Otherwise:

1. Look for a plan, todo, or task file in the working directory (TODO.md, PLAN.md, .ralph/PLAN.md, or similar).
2. Identify the next unchecked / unfinished task.
3. Do that task and update the file.
4. When all tasks are complete, end your response with the marker `<ralph-done reason="all tasks complete"/>` so the loop halts.

You can stop the loop yourself at any time by calling the `ralph_stop` tool with a short reason. The user can stop it by running `/ralph stop` or by creating a `.ralph/STOP` file in the working directory.
