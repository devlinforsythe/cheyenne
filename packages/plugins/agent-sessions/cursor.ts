// Cursor agent chats (the cursor-agent CLI): ~/.cursor/projects/<dashed cwd>/agent-transcripts/<chatId>/<chatId>.jsonl,
// with times, folder and title from ~/.cursor/chats/<hash>/<chatId>/meta.json. The transcripts keep no tool results and
// no timestamps: tools show "(no result recorded)" and messages are spread from createdAtMs to updatedAtMs.
// Headless `cursor-agent -p` runs never get a title in meta.json; only titled chats are imported.
// Continue: `cursor-agent --resume <chatId>`.
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { dirs, info, query, read, tool, transcript, type Source } from "./common"

const ROOT = join(homedir(), ".cursor")
const PROJECTS = join(ROOT, "projects")
const CHATS = join(ROOT, "chats")

// Read once per import pass, in list().
let metas = new Map<string, any>()
const readMetas = () => {
  const map = new Map<string, any>()
  for (const hash of dirs(CHATS))
    for (const chat of dirs(join(CHATS, hash)))
      try {
        map.set(chat, JSON.parse(readFileSync(join(CHATS, hash, chat, "meta.json"), "utf8")))
      } catch {}
  return map
}

export const sessionIdFor = (chatId: string) => "ses_cursor_" + chatId.replaceAll("-", "")

export const cursor: Source = {
  name: "cursor",
  list() {
    metas = readMetas()
    return dirs(PROJECTS).flatMap((project) =>
      dirs(join(PROJECTS, project, "agent-transcripts")).flatMap((chat) => {
        const file = join(PROJECTS, project, "agent-transcripts", chat, `${chat}.jsonl`)
        return existsSync(file) ? [{ id: chat, file, mtime: statSync(file).mtimeMs }] : []
      }),
    )
  },
  convert(t, opts) {
    const meta = metas.get(t.id) ?? {}
    if (!meta.title && !opts.headless) return
    const lines = read(t.file).filter((d) => d.role === "user" || d.role === "assistant")
    const created = meta.createdAtMs ?? statSync(t.file).birthtimeMs
    const updated = Math.max(created + lines.length, meta.updatedAtMs ?? t.mtime)
    const step = (updated - created) / Math.max(lines.length, 1)
    const model = { id: "cursor-agent", providerID: "cursor", variant: "default" }
    const out = transcript(model)
    let first: string | undefined
    lines.forEach((d, i) => {
      const time = Math.round(created + i * step)
      const content = d.message?.content ?? []
      if (d.role === "user") {
        const text = query(content)
        if (!text) return
        first ??= text
        out.user(text, time)
        return
      }
      content.forEach((b: any, j: number) => {
        if (b?.type === "text" && b.text?.trim()) out.assistant(time).push({ type: "text", text: b.text })
        if (b?.type === "tool_use") out.assistant(time).push(tool(b.id ?? `cursor_${i}_${j}`, b.name, b.input, time))
      })
    })
    if (!first) return
    return {
      info: info({
        id: sessionIdFor(t.id),
        model,
        created,
        updated,
        title: meta.title || first,
        directory: meta.cwd && existsSync(meta.cwd) ? meta.cwd : homedir(),
        metadata: { cursor: { sessionId: t.id, source: t.file } },
      }),
      messages: out.done(),
    }
  },
}
