// Cheyenne: Claude (Claude Code login, through the Agent SDK) as an OpenCode provider.
// opencode.jsonc points a `file://` provider at this file. OpenCode's dynamic loader calls the first `create*`
// export, so this file exports only createClaudeCode, wrapping ai-sdk-provider-claude-code's factory:
// - each call runs Claude in the OpenCode session's folder (the `Working directory:` line OpenCode puts in the
//   system prompt), gated like the workers' `claude -p --permission-mode acceptEdits`: file edits go through and
//   anything else that needs a permission prompt is refused, since no one is there to answer Claude's own prompts.
//   The owner opens the gate in opencode.jsonc, provider options `defaultSettings.permissionMode`: "auto" (Claude's
//   classifier decides) or "bypassPermissions" (no gate);
// - a native chat sends the whole conversation each turn and leaves no transcript in ~/.claude;
// - a session imported from Claude Code (import.ts) resumes that Claude session instead: the first turn forks
//   it into a new Claude session (the original transcript is never written to), later turns resume the fork,
//   and only the newest user message is sent.
import { createClaudeCode as base } from "ai-sdk-provider-claude-code"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { findImport, PROJECTS } from "./imports"

type Options = NonNullable<Parameters<typeof base>[0]>
type Model = ReturnType<ReturnType<typeof base>["languageModel"]>
type Call = Parameters<Model["doStream"]>[0]

const cwdOf = (call: Call) => {
  for (const m of call.prompt) {
    if (m.role !== "system") continue
    const dir = /Working directory: (.+)/.exec(m.content)?.[1]?.trim()
    if (dir && existsSync(dir)) return dir
  }
}

const transcriptExists = (id: string) =>
  readdirSync(PROJECTS).some((dir) => existsSync(join(PROJECTS, dir, `${id}.jsonl`)))

// The messages after the last assistant turn: what the owner just typed.
const newest = (prompt: Call["prompt"]) => {
  const last = prompt.findLastIndex((m) => m.role === "assistant")
  return prompt.slice(last + 1).filter((m) => m.role !== "system")
}

export function createClaudeCode(options: Options = {}) {
  const settings: NonNullable<Options["defaultSettings"]> = {
    permissionMode: "acceptEdits",
    permissionPrompts: "none",
    ...options.defaultSettings,
  }
  const provider = base({
    ...options,
    defaultSettings: { ...settings, allowDangerouslySkipPermissions: settings.permissionMode === "bypassPermissions" },
  })

  const resolve = (modelId: string, call: Call): [Model, Call] => {
    const cwd = cwdOf(call)
    const session = call.headers?.["x-opencode-session-id"]
    const imported = session ? findImport(session) : undefined
    if (!imported) return [provider.languageModel(modelId, { cwd, persistSession: false }), call]
    const forked = transcriptExists(imported.fork_id)
    const model = provider.languageModel(modelId, {
      cwd: imported.cwd ?? cwd,
      ...(forked
        ? { resume: imported.fork_id }
        : { resume: imported.claude_session_id, forkSession: true, sessionId: imported.fork_id }),
    })
    return [model, { ...call, prompt: newest(call.prompt) }]
  }

  const languageModel = (modelId: string): Model => {
    const probe = provider.languageModel(modelId)
    return {
      specificationVersion: probe.specificationVersion,
      provider: probe.provider,
      modelId,
      supportedUrls: probe.supportedUrls,
      doGenerate: (call) => {
        const [model, next] = resolve(modelId, call)
        return model.doGenerate(next)
      },
      doStream: (call) => {
        const [model, next] = resolve(modelId, call)
        return model.doStream(next)
      },
    } as Model
  }

  return Object.assign((modelId: string) => languageModel(modelId), {
    ...provider,
    specificationVersion: provider.specificationVersion,
    languageModel,
    chat: languageModel,
  })
}
