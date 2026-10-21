// Grok CLI sessions (x.ai's `grok`, ~/.grok/bin/grok): ~/.grok/sessions/<url-encoded cwd>/<uuid>/ with summary.json and
// chat_history.jsonl. Not Grok Bot (grokbot / gbot): that one keeps no transcripts locally, so it has no importer.
// chat_history lines carry no timestamps; messages are spread from created_at to updated_at in order.
// Skipped: session_kind "headless" (run_worker / missions, `grok --single`). Continue: `grok --resume <uuid>`.
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { complete, dirs, info, ms, query, read, tool, transcript, type Source } from "./common"

const SESSIONS = join(homedir(), ".grok", "sessions")

export const sessionIdFor = (uuid: string) => "ses_grok_" + uuid.replaceAll("-", "")

export const grok: Source = {
  name: "grok",
  list: () =>
    dirs(SESSIONS).flatMap((dir) =>
      dirs(join(SESSIONS, dir)).flatMap((id) => {
        const file = join(SESSIONS, dir, id, "chat_history.jsonl")
        return existsSync(file) ? [{ id, file, mtime: statSync(file).mtimeMs }] : []
      }),
    ),
  convert(t, opts) {
    let summary: any
    try {
      summary = JSON.parse(readFileSync(join(t.file, "..", "summary.json"), "utf8"))
    } catch {
      return
    }
    if (summary.session_kind === "headless" && !opts.headless) return
    const lines = read(t.file).filter((d) => !d.synthetic_reason && d.type !== "system" && d.type !== "reasoning")
    const created = ms(summary.created_at, t.mtime)
    const updated = Math.max(created + lines.length, ms(summary.updated_at, t.mtime))
    const step = (updated - created) / Math.max(lines.length, 1)
    const model = { id: summary.current_model_id ?? "grok", providerID: "grok", variant: "default" }
    const out = transcript(model)
    const tools = new Map<string, ReturnType<typeof tool>>()
    let first: string | undefined
    lines.forEach((d, i) => {
      const time = Math.round(created + i * step)
      if (d.type === "user") {
        const text = query(d.content)
        if (!text) return
        first ??= text
        out.user(text, time)
      }
      if (d.type === "assistant") {
        const content = out.assistant(time)
        if (typeof d.content === "string" && d.content.trim()) content.push({ type: "text", text: d.content })
        for (const c of d.tool_calls ?? []) {
          let input: unknown = c.arguments
          try {
            input = JSON.parse(c.arguments)
          } catch {}
          const call = tool(c.id, c.name, input, time)
          tools.set(c.id, call)
          content.push(call)
        }
      }
      if (d.type === "tool_result") {
        const call = tools.get(d.tool_call_id)
        if (call) complete(call, typeof d.content === "string" ? d.content : JSON.stringify(d.content), time)
      }
    })
    if (!first) return
    const cwd = summary.info?.cwd
    return {
      info: info({
        id: sessionIdFor(t.id),
        model,
        created,
        updated,
        title: summary.session_summary || first,
        directory: cwd && existsSync(cwd) ? cwd : homedir(),
        metadata: { grok: { sessionId: t.id, source: t.file } },
      }),
      messages: out.done(),
    }
  },
}
