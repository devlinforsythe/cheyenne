import { spawn } from "node:child_process"

// Cheyenne C2: each external worker keeps its own subscription login in its own CLI,
// so Cheyenne drives them by shelling out instead of as model providers.
// The flags give each worker write access inside its folder without prompting (nobody is
// there to answer a prompt); the brief is always the last argument.
// Shared by the run_worker tool (index.ts) and the mission runner (mission.ts); node stdlib only,
// so `bun mission.ts` runs it outside the server.
export const WORKERS = {
  claude: ["claude", "-p", "--permission-mode", "acceptEdits"],
  // ponytail: model pinned because ~/.codex/config.toml's default (gpt-6.1-sol, set by the Codex
  // picker) is refused on a ChatGPT login; drop -m when the subscription takes the default again.
  codex: ["codex", "exec", "-m", "gpt-5.6-sol", "--sandbox", "workspace-write", "--skip-git-repo-check"],
  cursor: ["cursor-agent", "-p", "--force", "--output-format", "text"],
  grok: ["grok", "--always-approve", "--single"],
} as const

export type Worker = keyof typeof WORKERS

export const WORKER_NAMES = Object.keys(WORKERS) as Worker[]

const MAX_SECONDS = 30 * 60
const TAIL = 20_000 // characters of output kept for the live view and the result

// The desktop server starts without the login shell's PATH (~/bin, ~/.local/bin, ~/.grok/bin),
// so every command goes through `zsh -lc`. The command and arguments are passed as $0 "$@",
// never spliced into the script, so the brief cannot inject shell syntax.
// `onStderr` splits stderr off (the rooms keep a reader's answer apart from its logs); by default it joins stdout.
export const run = (
  argv: readonly string[],
  cwd: string,
  signal: AbortSignal | undefined,
  onData: (text: string) => void,
  onStderr = onData,
) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn("/bin/zsh", ["-lc", 'exec "$0" "$@"', ...argv], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
      timeout: MAX_SECONDS * 1000,
    })
    child.stdout.setEncoding("utf8").on("data", onData)
    child.stderr.setEncoding("utf8").on("data", onStderr)
    child.on("error", reject)
    // codex traps the timeout's SIGTERM and exits 0, so a killed child counts as a failure (124, as timeout(1)).
    child.on("close", (code) => resolve(child.killed ? 124 : (code ?? 1)))
  })

export const tail = (text: string, size = TAIL) => (text.length > size ? "…" + text.slice(-size) : text)

/** One worker run plus its `brain log -a <worker>` entry. */
export async function runWorker(input: {
  worker: Worker
  brief: string
  dir: string
  business?: string
  topic?: string
  signal?: AbortSignal
  onData?: (text: string, output: string) => void
}) {
  let output = ""
  const started = Date.now()
  const code = await run([...WORKERS[input.worker], input.brief], input.dir, input.signal, (text) => {
    output += text
    input.onData?.(text, output)
  }).catch((error: Error) => {
    output += `\n[run_worker] ${error.message}`
    return -1
  })
  const seconds = Math.round((Date.now() - started) / 1000)
  const status = code === 0 ? "finished" : `failed (exit ${code})`

  const entry = `Cheyenne run_worker: ${input.worker} ${status} in ${seconds}s in ${input.dir}. Brief: ${input.brief.slice(0, 200)}`
  const log = ["brain", "log", "-a", input.worker]
  if (input.business) log.push("-b", input.business)
  if (input.topic) log.push("-t", input.topic)
  let logged = ""
  await run([...log, entry], input.dir, input.signal, (text) => (logged += text)).catch(
    (error: Error) => (logged = error.message),
  )
  return { code, status, seconds, output, logged: logged.trim() }
}
