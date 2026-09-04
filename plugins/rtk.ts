import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"
import { Plugin } from "@opencode-ai/plugin"

const execFile = promisify(execFileCallback)

// RTK OpenCode plugin — rewrites commands to use rtk for token savings.
// Requires: rtk >= 0.23.0 in PATH.
//
// This is a thin delegating plugin: all rewrite logic lives in `rtk rewrite`,
// which is the single source of truth (src/discover/registry.rs).
// To add or change rewrite rules, edit the Rust registry — not this file.

export const RtkOpenCodePlugin = Plugin.define({
  id: "rtk",
  setup: async (context) => {
    try {
      await execFile("rtk", ["--version"])
    } catch {
      console.warn("[rtk] rtk binary not found in PATH — plugin disabled")
      return
    }

    await context.shell.hook("create.before", async (event) => {
      try {
        const { stdout } = await execFile("rtk", ["rewrite", event.command])
        const rewritten = stdout.trim()
        if (rewritten && rewritten !== event.command) event.command = rewritten
      } catch {
        // rtk rewrite failed — pass through unchanged
      }
    })
  },
})

export default RtkOpenCodePlugin
