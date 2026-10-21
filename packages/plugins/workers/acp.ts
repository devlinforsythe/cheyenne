import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"

// Cheyenne C6: the workers over the Agent Client Protocol (agentclientprotocol.com), JSON-RPC 2.0 over the
// agent's stdio, one message per line. Cheyenne is the client: start the agent, initialize, open a session in the
// mission folder, send the brief, and turn the agent's session/update stream (messages, tool calls, plans, diffs)
// into the live view. Each agent still runs on its own CLI login: the adapters read the CLI's stored credentials,
// and this client never calls `authenticate`.
// Node stdlib only (no @agentclientprotocol/sdk) so `bun mission.ts` keeps running outside the server.
export const ACP_AGENTS = {
  claude: ["claude-agent-acp"], // npm @agentclientprotocol/claude-agent-acp
  // ponytail: same model pin as the shell row in workers.ts; drop it when the ChatGPT login takes the default.
  // (The adapter is node and takes no -c flags; CODEX_CONFIG is merged into the session config.)
  codex: ["env", 'CODEX_CONFIG={"model":"gpt-5.6-sol"}', "codex-acp"], // npm @agentclientprotocol/codex-acp
  cursor: ["cursor-agent", "acp"],
  grok: ["grok", "agent", "--no-leader", "stdio"],
} as const satisfies Record<string, readonly string[]>

/** Session modes set after session/new, so permission requests come to Cheyenne's policy (decide below). */
export const ACP_MODES: Record<string, string> = {
  // The adapter's default ("agent") lets a server classifier approve; workspace-write sandboxes commands to the
  // folder and asks the client (us) before anything outside it, like `codex exec --sandbox workspace-write`.
  codex: "workspace-write",
}

type ToolCall = {
  toolCallId?: string
  title?: string
  kind?: string
  status?: string
  locations?: { path: string }[]
  rawInput?: Record<string, unknown>
  content?: { type: string; path?: string; oldText?: string | null; newText?: string }[]
}
type Option = { optionId: string; kind: string }

// Real paths on both sides: agents report /private/var/… for /var/…; a file being created doesn't exist yet,
// so its nearest existing parent is resolved instead.
const real = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return dirname(path) === path ? path : resolve(real(dirname(path)), basename(path))
  }
}

const inside = (path: string, dir: string) => {
  const rel = relative(real(resolve(dir)), real(resolve(dir, path)))
  return !rel.startsWith("..") && !isAbsolute(rel)
}

const EDITS = ["edit", "delete", "move"]
// ponytail: reads are allowed anywhere (briefs point at files outside the folder, e.g. DESIGN-SYSTEM.md);
// shell commands, fetches and anything unknown are denied. Agents that sandbox their own commands (codex's
// workspace-write) never ask for those, so they still run.
const READS = ["read", "search", "think"]

/** The permission policy: edits inside the mission folder and reads are allowed; everything else is denied. */
export function decide(call: ToolCall, options: Option[], dir: string) {
  const raw = call.rawInput ?? {}
  const paths = [
    ...(call.locations ?? []).map((l) => l.path),
    ...["file_path", "path", "notebook_path"].flatMap((key) => (typeof raw[key] === "string" ? [raw[key] as string] : [])),
  ]
  const allow =
    READS.includes(call.kind ?? "") ||
    (EDITS.includes(call.kind ?? "") && paths.length > 0 && paths.every((path) => inside(path, dir)))
  const pick = (kinds: string[]) => kinds.map((kind) => options.find((o) => o.kind === kind)).find(Boolean)
  const option = allow ? pick(["allow_once", "allow_always"]) : pick(["reject_once", "reject_always"])
  return { allow, outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } }
}

const mark: Record<string, string> = { completed: "✓", failed: "✗" }

/** Renders one session/update as live-view text ("" for updates the view skips). */
export function format(update: any, titles: Map<string, string>) {
  const diffs = (call: ToolCall) =>
    (call.content ?? [])
      .filter((c) => c.type === "diff")
      .map((c) => {
        const count = (text?: string | null) => (text ? text.split("\n").length : 0)
        return `    ~ ${c.path} (${count(c.oldText)} → ${count(c.newText)} lines)\n`
      })
      .join("")
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return update.content?.type === "text" ? update.content.text : ""
    case "tool_call": {
      if (update.toolCallId) titles.set(update.toolCallId, update.title)
      return `\n▸ ${update.title}${update.kind ? ` [${update.kind}]` : ""}\n` + diffs(update)
    }
    case "tool_call_update": {
      if (update.title && update.toolCallId) titles.set(update.toolCallId, update.title)
      const done = mark[update.status] ? `  ${mark[update.status]} ${titles.get(update.toolCallId) ?? update.toolCallId}\n` : ""
      return done + diffs(update)
    }
    case "plan": {
      const box: Record<string, string> = { completed: "x", in_progress: "~" }
      return "\nPlan:\n" + (update.entries ?? []).map((e: any) => `  [${box[e.status] ?? " "}] ${e.content}\n`).join("")
    }
    default:
      return "" // thoughts, mode / command lists, echoed user chunks
  }
}

/** Thrown when the agent cannot start or open a session: nothing ran yet, so the caller may use the shell. */
export class HandshakeError extends Error {}

/**
 * One brief over ACP. Resolves with an exit-like code once the prompt has been sent (0 = end_turn, 124 = timed out,
 * else 1); rejects with HandshakeError if the agent never got the brief.
 */
export function runAcp(input: {
  argv: readonly string[]
  mode?: string
  dir: string
  brief: string
  signal?: AbortSignal
  timeoutMs: number
  onData: (text: string) => void
}) {
  return new Promise<number>((done, fail) => {
    // Same login-shell wrapper as workers.ts `run`: the server's PATH has no ~/.local/bin.
    const child = spawn("/bin/zsh", ["-lc", 'exec "$0" "$@"', ...input.argv], {
      cwd: input.dir,
      stdio: ["pipe", "pipe", "pipe"],
      signal: input.signal,
      timeout: input.timeoutMs,
    })
    let stderr = ""
    child.stderr.setEncoding("utf8").on("data", (text) => (stderr = (stderr + text).slice(-2000)))
    let prompted = false
    const pending = new Map<number, { ok: (v: any) => void; ko: (e: Error) => void }>()
    let next = 0
    const send = (message: object) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n")
    const call = (method: string, params: object) =>
      new Promise<any>((ok, ko) => {
        const id = ++next
        pending.set(id, { ok, ko })
        send({ id, method, params })
      })
    const titles = new Map<string, string>()
    const denied: string[] = []

    child.stdin.on("error", () => {}) // the agent died; "close" reports it
    createInterface({ input: child.stdout }).on("line", (line) => {
      let message: any
      try {
        message = JSON.parse(line)
      } catch {
        return // adapters may print stray non-JSON lines
      }
      if (message.method && message.id !== undefined) {
        // A request from the agent.
        if (message.method === "session/request_permission") {
          const { toolCall, options } = message.params
          const verdict = decide(toolCall ?? {}, options ?? [], input.dir)
          const what = toolCall?.title ?? toolCall?.kind ?? "tool call"
          if (!verdict.allow) denied.push(what)
          input.onData(`  ${verdict.allow ? "✔ allowed" : "⛔ denied"}: ${what}\n`)
          send({ id: message.id, result: { outcome: verdict.outcome } })
        } else send({ id: message.id, error: { code: -32601, message: `Cheyenne does not offer ${message.method}` } })
      } else if (message.method === "session/update") input.onData(format(message.params?.update ?? {}, titles))
      else if (message.id !== undefined) {
        const waiter = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) waiter?.ko(new Error(message.error.message ?? JSON.stringify(message.error)))
        else waiter?.ok(message.result)
      }
    })

    const handshake = (error: Error) => fail(new HandshakeError(`${error.message}${stderr ? `\n${stderr.trim()}` : ""}`))
    child.on("error", (error) => (prompted ? done(-1) : handshake(error)))
    child.on("close", (code) => {
      for (const waiter of pending.values()) waiter.ko(new Error(`agent exited (${code})`))
      if (!prompted) handshake(new Error(`agent exited (${code}) before the brief was sent`))
      // Timeout and abort kill the agent (codex-style SIGTERM traps included): count it as 124, as timeout(1).
      else done(child.killed ? 124 : -1)
    })

    // An agent that never answers the handshake (a stuck login, a leader that never comes up) falls back fast.
    const stuck = setTimeout(() => !prompted && (handshake(new Error("no ACP handshake in 2 minutes")), child.kill()), 120_000)
    child.on("close", () => clearTimeout(stuck))

    void (async () => {
      const init = await call("initialize", {
        protocolVersion: 1,
        // No fs / terminal offered: each agent edits and runs with its own tools, gated by request_permission.
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "cheyenne", version: "0.0.1" },
      })
      if (init?.protocolVersion !== 1) throw new Error(`agent speaks ACP v${init?.protocolVersion}, not v1`)
      const session = await call("session/new", { cwd: resolve(input.dir), mcpServers: [] })
      if (input.mode) await call("session/set_mode", { sessionId: session.sessionId, modeId: input.mode })
      prompted = true
      const prompt = (text: string) =>
        call("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text }] })
      let result = await prompt(input.brief)
      // codex and grok end the turn on a rejection ("No, and tell me what to do differently"); nobody is there to
      // answer, so tell them what the policy denied and let them carry on, a few times at most.
      for (let retry = 0; result?.stopReason === "cancelled" && denied.length && retry < 3; retry++) {
        const text =
          `Cheyenne's permission policy denied: ${denied.splice(0).join("; ")}. Only edits inside ${input.dir} are ` +
          "allowed, and shell commands outside your own sandbox are not. Carry on with the brief without them, and " +
          "say in your summary what you could not do."
        input.onData(`\n[acp] ${text}\n`)
        result = await prompt(text)
      }
      input.onData(`\n[acp] ${result?.stopReason}\n`)
      child.stdin.end()
      child.kill()
      done(result?.stopReason === "end_turn" ? 0 : 1)
    })().catch((error: Error) => {
      child.kill()
      if (prompted) {
        input.onData(`\n[acp] ${error.message}\n`)
        done(1)
      } else handshake(error)
    })
  })
}
