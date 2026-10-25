import { Plugin } from "@opencode/plugin"
import { claudeInput, claudeTool, runHooks } from "./hooks"

// Cheyenne: Claude Code's settings.json hooks in Cheyenne sessions, on OpenCode's plugin hook points (no core edits).
//   SessionStart     → session `context`: first request of each session runs it; stdout stays in the system prompt.
//   UserPromptSubmit → session `prompt`: stdout is appended to the prompt; a block replaces the prompt with the reason.
//   PreToolUse       → tool `execute.before`: a block rejects the call with the hook's reason.
//   PostToolUse      → tool `execute.after` (completed calls).
//   Stop             → `session.execution.succeeded` event.
export default Plugin.define({
  id: "cheyenne.claude-hooks",
  async setup(ctx) {
    const cwd = ctx.location.directory
    // ponytail: per server process, so a session resumed after a restart reruns SessionStart (as "startup").
    const started = new Map<string, Promise<string | undefined>>()

    await ctx.session.hook("context", async (event) => {
      if (!started.has(event.sessionID))
        started.set(
          event.sessionID,
          runHooks("SessionStart", cwd, "startup", { session_id: event.sessionID, source: "startup" }).then((r) => r.context),
        )
      const context = await started.get(event.sessionID)
      if (context) event.system.push({ type: "text", text: context })
    })

    await ctx.session.hook("prompt", async (event) => {
      const result = await runHooks("UserPromptSubmit", cwd, undefined, {
        session_id: event.sessionID,
        prompt: event.prompt.text,
      })
      // ponytail: the prompt hook cannot fail, so a block swaps the prompt for the reason instead of dropping it.
      // A real drop needs session `prompt` to get a failure channel in core (packages/core/src/plugin/hooks.ts).
      if (result.block) {
        event.prompt = {
          text: `[This prompt was blocked by a UserPromptSubmit hook: ${result.block}]\nReply only that the prompt was blocked, with the reason.`,
        }
        return
      }
      if (result.context)
        event.prompt.text += `\n\n<user-prompt-submit-hook>\n${result.context}\n</user-prompt-submit-hook>`
    })

    await ctx.tool.hook("execute.before", async (event) => {
      const tool = claudeTool(event.tool)
      const result = await runHooks("PreToolUse", cwd, tool, {
        session_id: event.sessionID,
        tool_name: tool,
        tool_input: claudeInput(event.input),
      })
      if (result.block) throw new Error(`PreToolUse hook blocked ${tool}: ${result.block}`)
    })

    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed") return
      const tool = claudeTool(event.tool)
      await runHooks("PostToolUse", cwd, tool, {
        session_id: event.sessionID,
        tool_name: tool,
        tool_input: claudeInput(event.input),
        tool_response: event.result,
      })
    })

    void (async () => {
      for await (const event of ctx.event.subscribe()) {
        if (event.type !== "session.execution.succeeded") continue
        await runHooks("Stop", cwd, undefined, { session_id: event.data.sessionID, stop_hook_active: false })
      }
    })()
  },
})
