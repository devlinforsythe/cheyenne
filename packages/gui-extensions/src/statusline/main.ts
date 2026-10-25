import { Option, Schema } from "effect"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { MainSetup } from "../sdk/main"
import { StatusLine } from "./contract"
import type definition from "./index"

const setup: MainSetup<typeof definition> = (ctx) => {
  ctx.provide(StatusLine, {
    run: async (input, caller) => {
      const setting = await read(input.directory)

      if (!setting) return { line: "", padding: 0 }
      const line = await run(setting.command, input.directory, input.payload, caller.signal).catch(() => "")

      return { line, padding: setting.padding }
    },
  })
}

export default setup

// Lowest precedence first; read on every run, so an edited setting shows on the next refresh.
const files = (directory: string) => [
  path.join(homedir(), ".config/opencode/opencode.json"),
  path.join(homedir(), ".config/opencode/opencode.jsonc"),
  path.join(directory, "opencode.json"),
  path.join(directory, "opencode.jsonc"),
  path.join(homedir(), ".claude/settings.json"),
  path.join(directory, ".claude/settings.json"),
  path.join(directory, ".claude/settings.local.json"),
]

const Settings = Schema.fromJsonString(
  Schema.Struct({
    statusLine: Schema.optional(
      Schema.Struct({
        type: Schema.Literal("command"),
        command: Schema.String,
        padding: Schema.optional(Schema.Number),
      }),
    ),
  }),
)

async function read(directory: string) {
  const found = await Promise.all(
    files(directory).map((file) =>
      readFile(file, "utf8").then(
        (text) => Option.getOrUndefined(Schema.decodeUnknownOption(Settings)(jsonc(text)))?.statusLine,
        () => undefined,
      ),
    ),
  )

  const setting = found.findLast((item) => item !== undefined)

  if (!setting) return

  return { command: setting.command, padding: setting.padding ?? 0 }
}

// ponytail: comments and trailing commas only; strings are kept whole. Use jsonc-parser if a file needs more.
const jsonc = (text: string) =>
  text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\/|,(?=\s*[}\]])/g, (_, string) => string ?? "")

// A login shell, as in the rooms' main, so the command finds what the owner's terminal finds.
const run = (command: string, cwd: string, payload: string, signal: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    const child = execFile(
      "/bin/zsh",
      ["-lc", command],
      { cwd, signal, timeout: 5000, maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout.split("\n")[0]?.trimEnd() ?? "")),
    )

    // A command that never reads stdin closes it early; that is not a failure.
    child.stdin?.on("error", () => {})
    child.stdin?.end(payload)
  })
