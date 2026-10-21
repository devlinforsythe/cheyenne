// Cheyenne: other agents' sessions in the sidebar (Codex, Grok CLI, Cursor agent), the way claude-code/imports.ts brings
// in Claude Code's. Each source lists its local transcripts and converts one into OpenCode's session transfer data;
// importSource() runs `opencode session import` for the new or changed ones and keeps a records file per source in
// ~/.cheyenne. The source folders (~/.codex, ~/.grok, ~/.cursor) are only ever read.
//   bun common.ts [codex|grok|cursor] [days] [--headless]
import { Identifier } from "@opencode/schema/identifier"
import { execFile } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"

export type Transcript = { id: string; file: string; mtime: number }

export type Source = {
  /** Metadata key and records file name: codex, grok, cursor. */
  name: string
  list(): Transcript[]
  /** The session transfer data, or undefined for a headless run or an empty transcript. */
  convert(t: Transcript, opts: { headless?: boolean }): { info: any; messages: any[] } | undefined
}

export type Record = {
  source_path: string
  source_session_id: string
  opencode_session_id: string
  cwd?: string
  title: string
  message_count: number
  source_modified_at: number
  imported_at: number
}

const recordsFile = (name: string) => join(homedir(), ".cheyenne", `${name}-imports.json`)

export const readRecords = (name: string): Record[] => {
  try {
    return JSON.parse(readFileSync(recordsFile(name), "utf8")).records
  } catch {
    return []
  }
}

const writeRecords = (name: string, records: Record[]) => {
  mkdirSync(dirname(recordsFile(name)), { recursive: true })
  writeFileSync(recordsFile(name), JSON.stringify({ records }, null, 2))
}

export const dirs = (dir: string) => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export const msgId = (time: number) => "msg_" + Identifier.create(false, time)

export const ms = (value: string | number | undefined, fallback: number) => {
  const t = typeof value === "number" ? value : value ? Date.parse(value) : NaN
  return Number.isNaN(t) ? fallback : t
}

export const read = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      try {
        return line.trim() ? [JSON.parse(line)] : []
      } catch {
        return []
      }
    })

// Grok and Cursor wrap the typed text in <user_query>; the rest (<user_info>, <timestamp>, reminders) is injected.
export const query = (content: unknown) => {
  const text = (Array.isArray(content) ? content : [{ type: "text", text: content }])
    .map((b: any) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("\n")
  const match = text.match(/<user_query>\n?([\s\S]*?)\n?<\/user_query>/)
  return match ? match[1]!.trim() : /^\s*</.test(text) ? "" : text.trim()
}

// Tokens pasted into a chat stay out of the OpenCode database. Airtable's shape is distinctive enough to match
// anywhere; the others need a word start (an "n" passes: in JSON a token often follows "\n").
// ponytail: known prefixes only, add a pattern per leak.
const SECRET =
  /(pat[A-Za-z0-9]{14}\.[a-f0-9]{64}|(?<![A-Za-mo-z0-9_-])(sk-(ant-|proj-)?[A-Za-z0-9_-]{32,}|xai-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|shp(at|ss|ca)_[a-f0-9]{32}))\b/g
export const redact = <T>(value: T): T => JSON.parse(JSON.stringify(value).replace(SECRET, "[redacted]"))

export const tool = (id: string, name: string, input: unknown, time: number) => ({
  type: "tool",
  id,
  name,
  executed: true,
  state: { status: "completed", input: input ?? {}, content: [{ type: "text", text: "(no result recorded)" }] },
  time: { created: time } as { created: number; completed?: number },
})

export const complete = (t: ReturnType<typeof tool>, text: string, time: number, error = false) => {
  text = text.trim() || "(no output)"
  t.state = error
    ? ({ status: "error", input: t.state.input, error: { type: "tool.execution", message: text } } as any)
    : { status: "completed", input: t.state.input, content: [{ type: "text", text }] }
  t.time.completed = time
}

/** Builds the messages list: user turns, and assistant turns that merge consecutive assistant output. */
export function transcript(model: { id: string; providerID: string; variant: string }) {
  const messages: any[] = []
  return {
    messages,
    user(text: string, time: number) {
      messages.push({ id: msgId(time), time: { created: time }, text, files: [], type: "user" })
    },
    assistant(time: number): any[] {
      let a = messages.at(-1)
      if (a?.type !== "assistant") {
        a = { id: msgId(time), time: { created: time }, type: "assistant", agent: "build", model, content: [] }
        messages.push(a)
      }
      a.time.completed = time
      return a.content
    },
    done: () => messages.filter((m) => m.type === "user" || m.content.length > 0),
  }
}

export const info = (input: {
  id: string
  model: { id: string; providerID: string; variant: string }
  created: number
  updated: number
  title: string
  directory: string
  metadata: object
}) => ({
  id: input.id,
  projectID: "global",
  model: input.model,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: input.created, updated: input.updated, idle: input.updated },
  title: input.title.split("\n")[0]!.slice(0, 80),
  location: { directory: input.directory },
  metadata: input.metadata,
})

// Async on purpose: the plugin runs inside the server that `opencode session import` talks to.
const exec = (args: string[]) =>
  promisify(execFile)(cli(), args, { timeout: 60_000, maxBuffer: 256 * 1024 * 1024 }).then(
    (out) => ({ out: out.stdout, error: "" }),
    (error) => ({ out: "", error: String(error.stderr || error.message) }),
  )

const cli = () => (basename(process.execPath).startsWith("opencode") ? process.execPath : "opencode")

// Once someone typed in the imported session in Cheyenne it holds turns the source lacks: never replace it then.
async function continuedHere(record: Record) {
  const { out } = await exec(["session", "export", record.opencode_session_id])
  try {
    return JSON.parse(out).messages.length > record.message_count
  } catch {
    return false
  }
}

// Transcripts convert() turned down (headless runs, Codex's copies of Claude sessions), by file and mtime, so the
// five-minute pass does not parse them again until they change.
const skipped = new Map<string, number>()

async function importOne(source: Source, t: Transcript, records: Record[], opts: { headless?: boolean }) {
  const existing = records.find((r) => r.source_session_id === t.id)
  if (existing && existing.source_modified_at >= t.mtime) return
  if (skipped.get(t.file) === t.mtime) return
  if (existing && (await continuedHere(existing))) return
  const converted = source.convert(t, opts)
  if (!converted) return void skipped.set(t.file, t.mtime)
  const data = redact(converted)
  if (existing) await exec(["session", "delete", existing.opencode_session_id])
  const tmp = join(tmpdir(), `cheyenne-${source.name}-${t.id}.json`)
  writeFileSync(tmp, JSON.stringify(data))
  const { error } = await exec(["session", "import", tmp, "--directory", data.info.location.directory])
  rmSync(tmp, { force: true })
  if (error && !/already exists/.test(error)) {
    console.error(`[${source.name} import] ${t.id}: ${error}`.trim())
    return
  }
  const record: Record = {
    source_path: t.file,
    source_session_id: t.id,
    opencode_session_id: data.info.id,
    cwd: data.info.location.directory,
    title: data.info.title,
    message_count: data.messages.length,
    source_modified_at: t.mtime,
    imported_at: Date.now(),
  }
  if (existing) records[records.indexOf(existing)] = record
  else records.push(record)
  return record
}

/** Import the source's sessions active in the last `days` days, newest first. */
export async function importSource(source: Source, days = 7, opts: { headless?: boolean } = {}) {
  const since = Date.now() - days * 86_400_000
  const records = readRecords(source.name)
  const imported: Record[] = []
  const recent = source
    .list()
    .filter((t) => t.mtime >= since)
    .sort((a, b) => b.mtime - a.mtime)
  for (const t of recent) {
    const record = await importOne(source, t, records, opts)
    if (record) imported.push(record)
  }
  if (imported.length) writeRecords(source.name, records)
  return imported
}

type Poll = { users: number; running: boolean; first?: ReturnType<typeof setTimeout>; timer?: ReturnType<typeof setInterval> }

/** A plugin setup that runs `run` after `first` ms and every five minutes, one run at a time per server process. The
 * server loads a copy of each plugin for every open folder and a fresh one when its files change: the newest copy's
 * run takes over the one timer, and the last copy unloaded stops it. */
export function every(name: string, first: number, run: () => Promise<unknown>) {
  const slots = globalThis as unknown as { [key: symbol]: Poll | undefined }
  const key = Symbol.for(`cheyenne.${name}`)
  const poll = (slots[key] ??= { users: 0, running: false })
  const tick = async () => {
    if (poll.running) return
    poll.running = true
    await run()
      .catch((error) => console.error(`[${name}]`, error))
      .finally(() => (poll.running = false))
  }
  const stop = () => {
    clearTimeout(poll.first)
    clearInterval(poll.timer)
  }
  stop()
  poll.users++
  poll.first = setTimeout(tick, first)
  poll.timer = setInterval(tick, 5 * 60_000)
  poll.timer.unref?.()
  return () => {
    if (--poll.users > 0) return
    stop()
    if (slots[key] === poll) delete slots[key]
  }
}

if (import.meta.main) {
  const { sources } = await import("./index")
  const [name, days] = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  const headless = process.argv.includes("--headless")
  for (const source of sources.filter((s) => !name || s.name === name)) {
    const out = await importSource(source, Number(days) || 7, { headless })
    for (const r of out) console.log(`${source.name}  ${r.opencode_session_id}  ${r.title}  (${r.cwd})`)
  }
}
