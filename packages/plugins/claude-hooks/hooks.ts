// Cheyenne: Claude Code's shell-command hooks, read from the same settings files Claude Code reads
// (~/.claude/settings.json, <project>/.claude/settings.json, <project>/.claude/settings.local.json) plus the hooks of
// the Claude Code plugins those files enable. Settings are re-read on every event, so edits apply without a restart.
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type Event = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "Stop"
type Command = { type: string; command?: string; timeout?: number }
type Group = { matcher?: string; hooks?: Command[] }
type HookMap = Partial<Record<string, Group[]>>
type Hook = { command: string; timeout?: number; root?: string }

/** OpenCode tool id → Claude Code tool name, so existing matchers like "Bash" or "Edit|Write" work. */
const TOOL_NAMES: Record<string, string> = {
  shell: "Bash",
  bash: "Bash",
  edit: "Edit",
  patch: "Edit",
  write: "Write",
  read: "Read",
  glob: "Glob",
  grep: "Grep",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  subagent: "Task",
  skill: "Skill",
  question: "AskUserQuestion",
}

export const claudeTool = (tool: string) => TOOL_NAMES[tool] ?? tool

/** OpenCode's camelCase inputs (filePath, oldString) in Claude Code's snake_case (file_path, old_string). */
export const claudeInput = (input: unknown) =>
  typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input).map(([key, value]) => [key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), value]))
    : input

/** Claude Code's rule: empty or "*" matches everything, a plain name list is exact, anything else is a regex. */
export const matches = (matcher: string | undefined, value: string | undefined) => {
  if (!matcher || matcher === "*") return true
  if (value === undefined) return false
  if (/^[\w|]+$/.test(matcher)) return matcher.split("|").includes(value)
  return new RegExp(matcher).test(value)
}

/** One hook's result in Claude Code's terms: exit 2 or a JSON deny blocks (stderr / reason as the reason), stdout is context. */
export const decide = (code: number | null, stdout: string, stderr: string) => {
  if (code === 2) return { block: stderr.trim() || "blocked by hook" }
  if (code !== 0) return {}
  const json = parseJson(stdout)
  if (!json) return { context: stdout.trim() || undefined }
  const specific = json.hookSpecificOutput ?? {}
  if (json.decision === "block" || specific.permissionDecision === "deny" || json.continue === false)
    return { block: String(specific.permissionDecisionReason ?? json.reason ?? json.stopReason ?? "blocked by hook") }
  return { context: specific.additionalContext ?? json.systemMessage }
}

export async function runHooks(event: Event, cwd: string, matchValue: string | undefined, input: Record<string, unknown>) {
  const hooks = load(cwd, event).filter((group) => matches(group.matcher, matchValue))
  const results = []
  for (const hook of hooks.flatMap((group) => group.hooks)) {
    const result = await exec(hook, cwd, JSON.stringify({ ...input, cwd, hook_event_name: event }))
    results.push(result)
    if (result.block) break
  }
  return {
    block: results.find((result) => result.block)?.block,
    context: results.flatMap((result) => (result.context ? [result.context] : [])).join("\n\n") || undefined,
  }
}

function load(cwd: string, event: Event) {
  const files = [
    join(homedir(), ".claude", "settings.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.local.json"),
  ].map(readJson)
  const plugins = Object.entries(Object.assign({}, ...files.map((file) => file?.enabledPlugins)))
    .filter(([, on]) => on === true)
    .flatMap(([id]) => pluginHooks(id))
  return [
    ...files.flatMap((file) => groups(file?.hooks, event)),
    ...plugins.flatMap((plugin) => groups(plugin.hooks, event, plugin.root)),
  ]
}

function groups(map: HookMap | undefined, event: Event, root?: string) {
  return (map?.[event] ?? []).map((group) => ({
    matcher: group.matcher,
    hooks: (group.hooks ?? [])
      .filter((hook) => hook.type === "command" && hook.command)
      .map((hook): Hook => ({ command: hook.command!, timeout: hook.timeout, root })),
  }))
}

// A Claude Code plugin's hooks: its install path from installed_plugins.json, then the file its plugin.json names
// (or hooks/hooks.json). The commands use ${CLAUDE_PLUGIN_ROOT}, which exec() sets.
function pluginHooks(id: string) {
  const installed = readJson(join(homedir(), ".claude", "plugins", "installed_plugins.json"))
  const root: string | undefined = installed?.plugins?.[id]?.[0]?.installPath
  if (!root) return []
  const manifest = readJson(join(root, ".claude-plugin", "plugin.json"))
  const file = typeof manifest?.hooks === "string" ? join(root, manifest.hooks) : join(root, "hooks", "hooks.json")
  const hooks = typeof manifest?.hooks === "object" ? manifest.hooks : readJson(file)
  return hooks ? [{ root, hooks: (hooks.hooks ?? hooks) as HookMap }] : []
}

function exec(hook: Hook, cwd: string, stdin: string) {
  return new Promise<{ block?: string; context?: string }>((resolve) => {
    // A login shell: the server's PATH has no ~/bin or Homebrew, and hooks call node, python, brain.
    const child = spawn("/bin/zsh", ["-lc", hook.command], {
      cwd: existsSync(cwd) ? cwd : homedir(),
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...(hook.root ? { CLAUDE_PLUGIN_ROOT: hook.root } : {}) },
      timeout: (hook.timeout ?? 60) * 1000,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", () => resolve({}))
    child.on("close", (code) => resolve(decide(code, stdout, stderr)))
    child.stdin.on("error", () => {})
    child.stdin.end(stdin)
  })
}

function readJson(file: string) {
  if (!existsSync(file)) return undefined
  return parseJson(readFileSync(file, "utf8"))
}

function parseJson(text: string) {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}
