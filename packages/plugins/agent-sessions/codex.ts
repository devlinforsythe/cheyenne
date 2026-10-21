// Codex threads (Codex Desktop and the codex CLI): ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl, titles from
// ~/.codex/session_index.jsonl. Skipped: `codex exec` runs and subagent threads, and the Claude Code sessions Codex
// imported itself (~/.codex/external_agent_session_imports.json) until a Codex turn ran in them — the claude-code
// plugin already shows those. Continue: `codex fork <uuid>` / `codex resume <uuid>` (agent-launch extension).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { complete, info, ms, read, tool, transcript, type Source, type Transcript } from "./common"

const ROOT = join(homedir(), ".codex")
const SESSIONS = join(ROOT, "sessions")

const files = (dir: string, depth: number): string[] => {
  try {
    return readdirSync(dir).flatMap((f) =>
      depth ? files(join(dir, f), depth - 1) : f.startsWith("rollout-") && f.endsWith(".jsonl") ? [join(dir, f)] : [],
    )
  } catch {
    return []
  }
}

const titles = () => {
  const map = new Map<string, string>()
  if (existsSync(join(ROOT, "session_index.jsonl")))
    for (const d of read(join(ROOT, "session_index.jsonl"))) if (d.thread_name) map.set(d.id, d.thread_name)
  return map
}

const claudeImports = () => {
  try {
    return new Set<string>(
      (JSON.parse(readFileSync(join(ROOT, "external_agent_session_imports.json"), "utf8")).records ?? []).map(
        (r: any) => r.imported_thread_id,
      ),
    )
  } catch {
    return new Set<string>()
  }
}

// Codex's own injections into the user turn: environment, AGENTS.md, aborted-turn markers.
const typed = (content: any[]) =>
  content
    .filter((b) => b?.type === "input_text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .filter((t) => !/^\s*(<[a-z_]+>|# AGENTS\.md instructions)/.test(t))
    .join("\n\n")
    .trim()

const outputText = (output: unknown): string =>
  typeof output === "string"
    ? output
    : Array.isArray(output)
      ? output.map((b) => b?.text ?? "").join("")
      : typeof (output as any)?.content === "string"
        ? (output as any).content
        : JSON.stringify(output ?? "")

const parse = (s: unknown) => {
  try {
    return typeof s === "string" ? JSON.parse(s) : s
  } catch {
    return { arguments: s }
  }
}

export const sessionIdFor = (uuid: string) => "ses_codex_" + uuid.replaceAll("-", "")

// Read once per import pass, in list().
let index = { titles: new Map<string, string>(), claude: new Set<string>() }

export const codex: Source = {
  name: "codex",
  list() {
    index = { titles: titles(), claude: claudeImports() }
    return files(SESSIONS, 3).map((file) => ({ id: file.slice(-41, -6), file, mtime: statSync(file).mtimeMs }))
  },
  convert(t: Transcript, opts) {
    const lines = read(t.file)
    const meta = lines[0]?.type === "session_meta" ? lines[0].payload : undefined
    if (!meta) return
    if (typeof meta.source === "object") return // subagent threads
    if (meta.source === "exec" && !opts.headless) return
    if (!lines.some((d) => d.type === "turn_context") && index.claude.has(meta.id)) return
    const model = {
      id: lines.find((d) => d.type === "turn_context")?.payload?.model ?? "gpt-5.6-sol",
      providerID: "codex",
      variant: "default",
    }
    const out = transcript(model)
    const tools = new Map<string, ReturnType<typeof tool>>()
    let first: string | undefined
    let last = ms(meta.timestamp, t.mtime)
    for (const d of lines) {
      if (d.type !== "response_item") continue
      const p = d.payload
      const time = (last = ms(d.timestamp, last))
      if (p.type === "message" && p.role === "user") {
        const text = typed(p.content ?? [])
        if (!text) continue
        first ??= text
        out.user(text, time)
      }
      if (p.type === "message" && p.role === "assistant")
        for (const b of p.content ?? [])
          if (b?.type === "output_text" && b.text?.trim()) out.assistant(time).push({ type: "text", text: b.text })
      if (p.type === "function_call" || p.type === "custom_tool_call") {
        const call = tool(p.call_id, p.name, p.type === "function_call" ? parse(p.arguments) : { input: p.input }, time)
        tools.set(p.call_id, call)
        out.assistant(time).push(call)
      }
      if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
        const call = tools.get(p.call_id)
        if (call) complete(call, outputText(p.output), time)
      }
    }
    if (!first) return
    const messages = out.done()
    return {
      info: info({
        id: sessionIdFor(meta.id),
        model,
        created: messages[0].time.created,
        updated: last,
        title: index.titles.get(meta.id) || first,
        directory: meta.cwd && existsSync(meta.cwd) ? meta.cwd : homedir(),
        metadata: { codex: { sessionId: meta.id, source: t.file } },
      }),
      messages,
    }
  },
}
