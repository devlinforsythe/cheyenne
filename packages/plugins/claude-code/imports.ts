// Cheyenne: Claude Code sessions in the sidebar, the way Codex imports them (~/.codex/external_agent_session_imports.json).
// Each transcript in ~/.claude/projects/*/<uuid>.jsonl becomes an OpenCode session through `opencode session import`,
// in the transcript's folder, with the session id derived from the Claude session id, so the sidebar groups it by
// project and provider.ts knows which Claude session to resume. ~/.claude is only ever read.
// Records: ~/.cheyenne/claude-code-imports.json.
//   bun imports.ts [days]          import sessions active in the last <days> (default 7)
//   bun imports.ts <session-uuid>  import that one session
import { Identifier } from "@opencode/schema/identifier"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"
// ponytail: one secret list for every importer; this plugin becomes an agent-sessions Source if it needs more of it.
import { redact } from "../agent-sessions/common"

export const PROJECTS = join(homedir(), ".claude", "projects")
const RECORDS = join(homedir(), ".cheyenne", "claude-code-imports.json")
const MODEL = { id: "opus", providerID: "claude-code", variant: "default" }

export type Record = {
  source_path: string
  claude_session_id: string
  opencode_session_id: string
  /** The Claude session a turn in Cheyenne forks into; provider.ts resumes it from then on. */
  fork_id: string
  cwd?: string
  title: string
  source_modified_at: number
  imported_at: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const sessionIdFor = (uuid: string) => "ses_claude_" + uuid.replaceAll("-", "")

const forkIdFor = (uuid: string) => {
  const h = createHash("sha1").update("cheyenne-fork:" + uuid).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export const readRecords = (): Record[] => {
  try {
    return JSON.parse(readFileSync(RECORDS, "utf8")).records
  } catch {
    return []
  }
}

const writeRecords = (records: Record[]) => {
  mkdirSync(dirname(RECORDS), { recursive: true })
  writeFileSync(RECORDS, JSON.stringify({ records }, null, 2))
}

export const findImport = (opencodeSessionId: string) =>
  opencodeSessionId.startsWith("ses_claude_")
    ? readRecords().find((r) => r.opencode_session_id === opencodeSessionId)
    : undefined

const transcripts = () =>
  readdirSync(PROJECTS).flatMap((dir) => {
    try {
      return readdirSync(join(PROJECTS, dir))
        .filter((f) => UUID.test(f.replace(/\.jsonl$/, "")) && f.endsWith(".jsonl"))
        .map((f) => join(PROJECTS, dir, f))
    } catch {
      return []
    }
  })

const ms = (iso: string | undefined, fallback: number) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? fallback : t
}

const id = (prefix: string, time: number) => prefix + Identifier.create(false, time)

// Text the owner typed, without the harness's own injections (slash-command echoes, reminders, hook output).
const typed = (content: unknown) => {
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : []
  return blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .filter((t) => !/^\s*<(system-reminder|local-command|command-|bash-|task-notification)/.test(t))
    .join("\n\n")
    .trim()
}

const resultText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((b) => (b?.type === "text" ? b.text : `[${b?.type}]`)).join("\n")
      : ""

/** One Claude Code transcript as OpenCode's session transfer data, or undefined when there is nothing to show. */
export function convert(file: string) {
  const uuid = basename(file, ".jsonl")
  const mtime = statSync(file).mtimeMs
  const messages: any[] = []
  const tools = new Map<string, any>()
  let title = ""
  let aiTitle = ""
  let cwd: string | undefined
  let first: string | undefined
  let last = 0

  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    if (d.type === "custom-title") title = d.customTitle ?? title
    if (d.type === "ai-title") aiTitle = d.aiTitle ?? aiTitle
    if ((d.type !== "user" && d.type !== "assistant") || d.isSidechain || d.isMeta || d.isCompactSummary) continue
    cwd ??= d.cwd
    // Headless `claude -p` jobs (entrypoint sdk-cli / sdk-ts) are not conversations to continue.
    if (!messages.length && d.entrypoint?.startsWith("sdk-")) return
    const time = ms(d.timestamp, last || mtime)
    last = time
    const content = d.message?.content
    const prev = messages.at(-1)

    if (d.type === "user") {
      for (const b of Array.isArray(content) ? content : []) {
        if (b?.type !== "tool_result") continue
        const tool = tools.get(b.tool_use_id)
        if (!tool) continue
        const text = resultText(b.content).trim() || "(no output)"
        tool.state = b.is_error
          ? { status: "error", input: tool.state.input, error: { type: "tool.execution", message: text } }
          : { status: "completed", input: tool.state.input, content: [{ type: "text", text }] }
        tool.time.completed = time
      }
      const text = typed(content)
      if (!text) continue
      first ??= text
      messages.push({ id: id("msg_", time), time: { created: time }, text, files: [], type: "user" })
      continue
    }

    const assistant =
      prev?.type === "assistant"
        ? prev
        : (messages.push({
            id: id("msg_", time),
            time: { created: time },
            type: "assistant",
            agent: "build",
            model: MODEL,
            content: [],
          }),
          messages.at(-1))
    assistant.time.completed = time
    for (const b of Array.isArray(content) ? content : []) {
      if (b?.type === "text" && b.text?.trim()) assistant.content.push({ type: "text", text: b.text })
      if (b?.type === "thinking" && b.thinking?.trim()) assistant.content.push({ type: "reasoning", text: b.thinking })
      if (b?.type === "tool_use") {
        const tool = {
          type: "tool",
          id: b.id,
          name: b.name,
          executed: true,
          state: { status: "completed", input: b.input ?? {}, content: [{ type: "text", text: "(no result recorded)" }] },
          time: { created: time },
        }
        tools.set(b.id, tool)
        assistant.content.push(tool)
      }
    }
  }

  // Runs Cheyenne itself started through provider.ts carry OpenCode's system prompt as their first message.
  if (!first || first.startsWith("You are an AI agent running in OpenCode")) return
  const created = messages[0].time.created
  const info = {
    id: sessionIdFor(uuid),
    projectID: "global",
    model: MODEL,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created, updated: last, idle: last },
    title: title || aiTitle || first.split("\n")[0]!.slice(0, 80),
    location: { directory: cwd && existsSync(cwd) ? cwd : homedir() },
    metadata: { claudeCode: { sessionId: uuid, source: file } },
  }
  return { info, messages: messages.filter((m) => m.type === "user" || m.content.length > 0) }
}

// Async on purpose: the plugin runs inside the server that `opencode session import` talks to.
const exec = (args: string[]) =>
  promisify(execFile)(cli(), args, { timeout: 60_000 }).then(
    () => "",
    (error) => String(error.stderr || error.message),
  )

const cli = () => (basename(process.execPath).startsWith("opencode") ? process.execPath : "opencode")

async function importOne(file: string, records: Record[]) {
  const uuid = basename(file, ".jsonl")
  const mtime = statSync(file).mtimeMs
  if (records.some((r) => r.fork_id === uuid)) return // a Cheyenne continuation: already in its OpenCode session
  const existing = records.find((r) => r.claude_session_id === uuid)
  if (existing && existing.source_modified_at >= mtime) return
  const fork_id = forkIdFor(uuid)
  // Once a turn ran in Cheyenne the OpenCode session holds turns the transcript lacks: never replace it then.
  if (existing && readdirSync(PROJECTS).some((dir) => existsSync(join(PROJECTS, dir, `${fork_id}.jsonl`)))) return
  const converted = convert(file)
  if (!converted) return
  const data = redact(converted)
  if (existing) await exec(["session", "delete", existing.opencode_session_id])
  const tmp = join(tmpdir(), `cheyenne-claude-${uuid}.json`)
  writeFileSync(tmp, JSON.stringify(data))
  const error = await exec(["session", "import", tmp, "--directory", data.info.location.directory])
  rmSync(tmp, { force: true })
  if (error && !/already exists/.test(error)) {
    console.error(`[claude-code import] ${uuid}: ${error}`.trim())
    return
  }
  const record: Record = {
    source_path: file,
    claude_session_id: uuid,
    opencode_session_id: data.info.id,
    fork_id,
    cwd: data.info.location.directory,
    title: data.info.title,
    source_modified_at: mtime,
    imported_at: Date.now(),
  }
  if (existing) records[records.indexOf(existing)] = record
  else records.push(record)
  return record
}

/** Import the Claude Code sessions active in the last `days` days (newest first, at most `limit`). */
export async function importRecent(days = 7, limit = 60) {
  const since = Date.now() - days * 86_400_000
  const records = readRecords()
  const files = transcripts()
    .map((f) => ({ f, t: statSync(f).mtimeMs }))
    .filter((x) => x.t >= since)
    .sort((a, b) => b.t - a.t)
    .slice(0, limit)
  const imported: Record[] = []
  for (const { f } of files) {
    const record = await importOne(f, records)
    if (record) imported.push(record)
  }
  if (imported.length) writeRecords(records)
  return imported
}

export async function importSession(uuid: string) {
  const file = transcripts().find((f) => basename(f, ".jsonl") === uuid)
  if (!file) throw new Error(`No Claude Code transcript ${uuid} in ${PROJECTS}`)
  const records = readRecords()
  const record = await importOne(file, records)
  if (record) writeRecords(records)
  return record ?? records.find((r) => r.claude_session_id === uuid)
}

if (import.meta.main) {
  const arg = process.argv[2]
  const out = arg && UUID.test(arg) ? [await importSession(arg)] : await importRecent(Number(arg) || 7)
  for (const r of out) if (r) console.log(`${r.opencode_session_id}  ${r.title}  (${r.cwd})`)
}
