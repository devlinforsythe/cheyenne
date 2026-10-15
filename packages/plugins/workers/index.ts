import { Plugin } from "@opencode/plugin"
import { Schema } from "effect"
import { spawn } from "node:child_process"

// Cheyenne C2: each external worker keeps its own subscription login in its own CLI,
// so Cheyenne drives them by shelling out instead of as model providers.
// The flags give each worker write access inside mission_dir without prompting (nobody is
// there to answer a prompt); the brief is always the last argument.
const WORKERS = {
  claude: ["claude", "-p", "--permission-mode", "acceptEdits"],
  // ponytail: model pinned because ~/.codex/config.toml's default (gpt-6.1-sol, set by the Codex
  // picker) is refused on a ChatGPT login; drop -m when the subscription takes the default again.
  codex: ["codex", "exec", "-m", "gpt-5.6-sol", "--sandbox", "workspace-write", "--skip-git-repo-check"],
  cursor: ["cursor-agent", "-p", "--force", "--output-format", "text"],
  grok: ["grok", "--always-approve", "--single"],
} as const

const MAX_SECONDS = 30 * 60
const TAIL = 20_000 // characters of output kept for the live view and the result

// The desktop server starts without the login shell's PATH (~/bin, ~/.local/bin, ~/.grok/bin),
// so every command goes through `zsh -lc`. The command and arguments are passed as $0 "$@",
// never spliced into the script, so the brief cannot inject shell syntax.
const run = (argv: readonly string[], cwd: string, signal: AbortSignal, onData: (text: string) => void) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn("/bin/zsh", ["-lc", 'exec "$0" "$@"', ...argv], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
      timeout: MAX_SECONDS * 1000,
    })
    child.stdout.setEncoding("utf8").on("data", onData)
    child.stderr.setEncoding("utf8").on("data", onData)
    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? 1))
  })

const tail = (text: string) => (text.length > TAIL ? "…" + text.slice(-TAIL) : text)

export default Plugin.define({
  id: "cheyenne.workers",
  async setup(ctx) {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "run_worker",
        options: { codemode: false },
        description: [
          "Run one stage brief through an external worker CLI, logged in with the owner's own subscription.",
          "claude = Claude Code (plans, multi-file code, verification); codex = Codex (visuals / UI);",
          "cursor = Cursor agent (code review, parallel builds); grok = Grok Build (research, builds).",
          "The worker runs in mission_dir with write access there, its output streams into this call,",
          "and a `brain log -a <worker>` entry records the run when it ends. Runs are capped at 30 minutes.",
        ].join(" "),
        input: Schema.Struct({
          worker: Schema.Literals(["claude", "codex", "cursor", "grok"]),
          stage_brief: Schema.String.annotate({ description: "The full prompt for the worker" }),
          mission_dir: Schema.String.annotate({ description: "Absolute path the worker runs in" }),
          business: Schema.optionalKey(Schema.String).annotate({
            description: "brain business for the log entry (default: the one mission_dir belongs to)",
          }),
          topic: Schema.optionalKey(Schema.String).annotate({ description: "brain workstream for the log entry" }),
        }),
        async execute({ worker, stage_brief, mission_dir, business, topic }, context) {
          let output = ""
          let last = 0
          const started = Date.now()
          const code = await run([...WORKERS[worker], stage_brief], mission_dir, context.signal, (text) => {
            output += text
            // ponytail: progress throttled to ~2/s; the UI only needs the latest tail
            if (Date.now() - last < 500) return
            last = Date.now()
            void context.progress({ worker, output: tail(output) })
          }).catch((error: Error) => {
            output += `\n[run_worker] ${error.message}`
            return -1
          })
          const seconds = Math.round((Date.now() - started) / 1000)
          const status = code === 0 ? "finished" : `failed (exit ${code})`

          const entry = `Cheyenne run_worker: ${worker} ${status} in ${seconds}s in ${mission_dir}. Brief: ${stage_brief.slice(0, 200)}`
          const log = ["brain", "log", "-a", worker]
          if (business) log.push("-b", business)
          if (topic) log.push("-t", topic)
          let logged = ""
          await run([...log, entry], mission_dir, context.signal, (text) => (logged += text)).catch(
            (error: Error) => (logged = error.message),
          )

          const content = `${worker} ${status} in ${seconds}s\n${logged.trim()}\n\n${tail(output).trim()}`
          return { content, metadata: { worker, exit: code, seconds, output: tail(output), brain: logged.trim() } }
        },
      })
    })
  },
})
