import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

/**
 * Ralph Loop Plugin
 *
 * Autonomously re-prompts an agent in a session until a stop condition is met.
 *
 * Activation:
 *   /ralph [initial prompt...]   (slash command kicks off iteration 1)
 *
 * The loop runs on whichever agent is currently active in opencode when the
 * command is invoked. To run on a different agent, switch agents in opencode
 * first, then run `/ralph`.
 *
 * Stop:
 *   /ralph stop                          (slash command)
 *   ralph_stop tool                      (agent-callable)
 *   <ralph-done reason="..."/>           (model-emitted marker in last message)
 *   .ralph/STOP                          (sentinel file in working directory)
 *   max iterations reached               (default 30)
 *   session error                        (auto-stop)
 *
 * State is in-memory only. Restarting opencode kills active loops.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICE = "ralph";
const DEFAULT_MAX_ITERATIONS = 30;
const FALLBACK_AGENT = "build";
const PROMPT_PATH = ".ralph/PROMPT.md";
const SENTINEL_PATH = ".ralph/STOP";
const COMMAND_NAME = "ralph";
const DONE_MARKER_REGEX = /<ralph-done\s+reason="([^"]*)"\s*\/?>/i;
const DEFAULT_PROMPT = `Continue the work. Read any plan, todo, or task file in the working directory. Do the next unchecked task. Update the file. If everything is done, end your response with the marker <ralph-done reason="all tasks complete"/> and stop.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoopState = {
  active: boolean;
  /** Resolved lazily from the kickoff user message; null until then. */
  agent: string | null;
  iteration: number;
  maxIterations: number;
  /**
   * IDs of every user message this plugin has originated (kickoff + every
   * re-prompt). `handleSessionIdle` uses this set to distinguish loop-driven
   * idles from idles caused by the human typing mid-loop.
   */
  ralphMessageIds: Set<string>;
  startedAt: number;
  /** Set when the agent invokes the `ralph_stop` tool, captured for the next idle. */
  toolStopReason: string | null;
};

type ParsedCommand =
  | { action: "start" }
  | { action: "stop" };

type StopDecision = { stop: false } | { stop: true; reason: string };

// ---------------------------------------------------------------------------
// Module-level state
//
// Shared between the plugin's hooks and the `ralph_stop` tool's `execute`. The
// tool runs inside the same Node/Bun process as the plugin module so this map
// is the synchronization point. Keyed by sessionID.
// ---------------------------------------------------------------------------

const loops: Map<string, LoopState> = new Map();

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function parseRalphCommand(argString: string): ParsedCommand {
  const trimmed = (argString ?? "").trim().toLowerCase();
  if (trimmed === "stop" || trimmed === "halt" || trimmed === "cancel") {
    return { action: "stop" };
  }
  return { action: "start" };
}

function applyTemplate(template: string, iteration: number): string {
  return template.replace(/\$ITERATION\b/g, String(iteration));
}

function findDoneMarker(text: string): string | null {
  const match = DONE_MARKER_REGEX.exec(text);
  return match ? match[1] : null;
}

function extractAssistantText(parts: Array<unknown>): string {
  let combined = "";
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text"
    ) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") combined += text + "\n";
    }
  }
  return combined;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const RalphPlugin: Plugin = async ({ client, directory, $ }) => {
  // ---- logging shorthand ----
  type LogLevel = "debug" | "info" | "warn" | "error";
  const log = (
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>,
  ) =>
    client.app
      .log({ body: { service: SERVICE, level, message, extra } })
      .catch(() => {
        /* logging must never throw the loop down */
      });

  const toast = (
    message: string,
    variant: "info" | "success" | "warning" | "error" = "info",
  ) =>
    client.tui
      .showToast({ body: { message, variant, title: "Ralph" } })
      .catch(() => {
        /* toast best-effort */
      });

  // ---- pure-ish helpers that need filesystem / client access ----

  async function readPromptTemplate(): Promise<string> {
    try {
      const file = Bun.file(`${directory}/${PROMPT_PATH}`);
      if (await file.exists()) {
        const text = await file.text();
        if (text.trim().length > 0) return text;
      }
    } catch {
      /* fall through to default */
    }
    return DEFAULT_PROMPT;
  }

  async function sentinelExists(): Promise<boolean> {
    try {
      return await Bun.file(`${directory}/${SENTINEL_PATH}`).exists();
    } catch {
      return false;
    }
  }

  async function deleteSentinel(): Promise<void> {
    try {
      await $`rm -f ${`${directory}/${SENTINEL_PATH}`}`.quiet();
    } catch (err) {
      await log("warn", "failed to delete sentinel", {
        error: String(err),
      });
    }
  }

  type SessionMessageEntry = {
    info?: { id?: string; role?: string; agent?: string };
    parts?: unknown[];
  };

  async function fetchMessages(
    sessionId: string,
  ): Promise<SessionMessageEntry[]> {
    try {
      const response = await client.session.messages({
        path: { id: sessionId },
      });
      const messages = (response as { data?: unknown }).data;
      return Array.isArray(messages)
        ? (messages as SessionMessageEntry[])
        : [];
    } catch (err) {
      await log("warn", "failed to read messages", { error: String(err) });
      return [];
    }
  }

  function lastAssistantText(messages: SessionMessageEntry[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const entry = messages[i];
      if (entry?.info?.role === "assistant" && Array.isArray(entry.parts)) {
        return extractAssistantText(entry.parts);
      }
    }
    return "";
  }

  function lastUserMessage(
    messages: SessionMessageEntry[],
  ): { id: string; agent: string | null } | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const entry = messages[i];
      if (entry?.info?.role === "user" && typeof entry.info.id === "string") {
        const agent =
          typeof entry.info.agent === "string" && entry.info.agent.length > 0
            ? entry.info.agent
            : null;
        return { id: entry.info.id, agent };
      }
    }
    return null;
  }

  async function checkStopConditions(
    state: LoopState,
    messages: SessionMessageEntry[],
  ): Promise<StopDecision> {
    if (state.toolStopReason !== null) {
      return { stop: true, reason: state.toolStopReason };
    }

    if (state.iteration >= state.maxIterations) {
      return {
        stop: true,
        reason: `max iterations (${state.maxIterations}) reached`,
      };
    }

    if (await sentinelExists()) {
      await deleteSentinel();
      return { stop: true, reason: "stop sentinel file present" };
    }

    const text = lastAssistantText(messages);
    const markerReason = findDoneMarker(text);
    if (markerReason !== null) {
      return { stop: true, reason: `model emitted done marker: ${markerReason}` };
    }

    return { stop: false };
  }

  async function stopLoop(
    sessionId: string,
    reason: string,
    variant: "info" | "success" | "warning" | "error" = "success",
  ): Promise<void> {
    const state = loops.get(sessionId);
    // Idempotent: a second concurrent stop (e.g. tool + sentinel firing on the
    // same idle, or session.error racing /ralph stop) must not double-toast.
    if (!state || !state.active) return;
    state.active = false;
    await log("info", `loop stopped: ${reason}`, {
      sessionId,
      iteration: state.iteration,
    });
    await toast(
      `Ralph stopped after ${state.iteration} iteration(s): ${reason}`,
      variant,
    );
    // Drop state so the map doesn't grow unbounded over the opencode lifetime.
    loops.delete(sessionId);
  }

  async function rePrompt(sessionId: string, state: LoopState): Promise<void> {
    if (!state.agent) {
      // Should be impossible past kickoff resolution, but fail loud rather
      // than silently dispatch with an undefined agent.
      await log("error", "rePrompt called with no resolved agent", {
        sessionId,
      });
      await stopLoop(sessionId, "internal error: agent unresolved", "error");
      return;
    }

    const template = await readPromptTemplate();
    const prompt = applyTemplate(template, state.iteration + 1);
    const messageId = crypto.randomUUID();

    // Register the ID *before* the call so a fast `session.idle` echo can't
    // arrive and be misclassified as a user-typed message.
    state.ralphMessageIds.add(messageId);

    try {
      await client.session.prompt({
        path: { id: sessionId },
        body: {
          messageID: messageId,
          agent: state.agent,
          parts: [{ type: "text", text: prompt }],
        },
      });

      state.iteration += 1;

      await log("info", `iteration ${state.iteration} dispatched`, {
        sessionId,
        agent: state.agent,
        messageId,
      });
    } catch (err) {
      // Roll back the optimistic registration so the set stays accurate.
      state.ralphMessageIds.delete(messageId);
      const message = err instanceof Error ? err.message : String(err);
      await log("error", `re-prompt failed: ${message}`, { sessionId });
      await stopLoop(sessionId, `re-prompt failed: ${message}`, "error");
    }
  }

  // ---- event handlers ----

  async function handleCommandExecuted(
    properties: { name: string; sessionID: string; arguments: string; messageID: string },
  ): Promise<void> {
    if (properties.name !== COMMAND_NAME) return;

    const sessionId = properties.sessionID;
    const parsed = parseRalphCommand(properties.arguments);

    if (parsed.action === "stop") {
      await stopLoop(sessionId, "user requested stop");
      return;
    }

    // Start. The slash command itself produces the iteration-1 user turn (its
    // body becomes the first prompt), so we don't fire an extra prompt here -
    // we register state and let `session.idle` drive subsequent iterations.
    //
    // We seed `ralphMessageIds` with the kickoff user-message ID so the first
    // `session.idle` is correctly attributed to the loop.
    //
    // Agent is resolved lazily in `handleSessionIdle` from the assistant
    // message metadata: the loop runs on whatever agent opencode was using
    // when the user invoked `/ralph`.
    const ralphMessageIds = new Set<string>();
    if (properties.messageID) ralphMessageIds.add(properties.messageID);

    const state: LoopState = {
      active: true,
      agent: null,
      iteration: 1, // the command's own turn counts as iteration 1
      maxIterations: DEFAULT_MAX_ITERATIONS,
      ralphMessageIds,
      startedAt: Date.now(),
      toolStopReason: null,
    };
    loops.set(sessionId, state);

    await log("info", `loop started`, {
      sessionId,
      maxIterations: state.maxIterations,
      kickoffMessageId: properties.messageID || null,
    });
    await toast(
      `Ralph loop started (max: ${state.maxIterations}). Drop .ralph/STOP, run /ralph stop, or wait for <ralph-done/>.`,
      "info",
    );
  }

  async function handleSessionIdle(properties: {
    sessionID?: string;
  }): Promise<void> {
    const sessionId = properties.sessionID;
    if (!sessionId) {
      await log("warn", "session.idle without sessionID", {
        properties: properties as unknown as Record<string, unknown>,
      });
      return;
    }

    const state = loops.get(sessionId);
    if (!state || !state.active) return;

    // Re-entrancy guard: the most recent user message in this session must be
    // one the plugin itself originated. If the human typed something mid-loop,
    // its message ID will not be in `ralphMessageIds` and we wait silently for
    // the next loop-driven turn to complete (the loop stays active).
    const messages = await fetchMessages(sessionId);
    const latestUser = lastUserMessage(messages);
    if (!latestUser) {
      await log("debug", "idle ignored: no user message in session", {
        sessionId,
      });
      return;
    }
    if (!state.ralphMessageIds.has(latestUser.id)) {
      await log("debug", "idle ignored: latest user turn is not Ralph's", {
        sessionId,
        latestUserId: latestUser.id,
      });
      return;
    }

    // Resolve the agent on the first idle - whichever agent ran the kickoff
    // turn is the agent the loop will keep running on.
    if (!state.agent) {
      state.agent = latestUser.agent ?? FALLBACK_AGENT;
      await log("info", `agent resolved`, {
        sessionId,
        agent: state.agent,
        fallback: latestUser.agent === null,
      });
    }

    const decision = await checkStopConditions(state, messages);
    if (decision.stop) {
      await stopLoop(sessionId, decision.reason);
      return;
    }

    await rePrompt(sessionId, state);
  }

  async function handleSessionError(properties: {
    sessionID?: string;
    error?: { message?: string; data?: unknown };
  }): Promise<void> {
    const sessionId = properties.sessionID;
    if (!sessionId) return;
    const state = loops.get(sessionId);
    if (!state || !state.active) return;

    const errMessage =
      properties.error?.message ?? "session error (no message)";
    await log("error", `session error: ${errMessage}`, { sessionId });
    await stopLoop(sessionId, `session error: ${errMessage}`, "error");
  }

  async function handleSessionDeleted(properties: {
    info?: { id?: string };
  }): Promise<void> {
    const sessionId = properties.info?.id;
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    const state = loops.get(sessionId);
    if (!state) return;
    state.active = false;
    loops.delete(sessionId);
    await log("info", "loop dropped: session deleted", { sessionId });
  }

  await log("info", "ralph plugin loaded");

  // ---- hooks return ----
  return {
    event: async ({ event }) => {
      if (event.type === "command.executed") {
        await handleCommandExecuted(event.properties);
        return;
      }
      if (event.type === "session.idle") {
        await handleSessionIdle(event.properties);
        return;
      }
      if (event.type === "session.error") {
        await handleSessionError(event.properties);
        return;
      }
      if (event.type === "session.deleted") {
        await handleSessionDeleted(event.properties);
        return;
      }
    },

    tool: {
      ralph_stop: tool({
        description:
          "Stop the active Ralph loop for the current session. Call this when work is complete or cannot proceed. The loop will halt before its next iteration.",
        args: {
          reason: tool.schema
            .string()
            .min(1)
            .describe("Why the loop is stopping (one short sentence)"),
        },
        async execute(args, ctx) {
          const state = loops.get(ctx.sessionID);
          if (!state) {
            return "No active Ralph loop in this session.";
          }
          state.toolStopReason = args.reason;
          return `Ralph loop will halt after this turn. Reason: ${args.reason}`;
        },
      }),
    },
  };
};

export default RalphPlugin;
