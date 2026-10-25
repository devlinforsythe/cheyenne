import os from "node:os"
import path from "node:path"
import { Glob } from "bun"

export type Style = {
  name: string
  description: string
  source: "builtin" | "user" | "project"
  keepCodingInstructions: boolean
  prompt: string
}

const BUILTIN: Style[] = [
  {
    name: "Default",
    description: "The standard coding assistant prompt, unchanged",
    source: "builtin",
    keepCodingInstructions: true,
    prompt: "",
  },
  {
    name: "Explanatory",
    description: "Adds short educational insights about the choices made while working",
    source: "builtin",
    keepCodingInstructions: true,
    prompt: [
      "# Output style: Explanatory",
      "Besides doing the task, help the user understand the codebase and the reasoning behind your choices.",
      "Before and after writing code, add a brief insight block formatted exactly like this:",
      "`★ Insight ─────────────────────────────────────`",
      "[2-3 short points specific to this code or decision, not general programming advice]",
      "`─────────────────────────────────────────────────`",
      "Keep insights in the conversation, never in the code itself.",
    ].join("\n"),
  },
  {
    name: "Learning",
    description: "Pauses to have the user write small, meaningful pieces of code themselves",
    source: "builtin",
    keepCodingInstructions: true,
    prompt: [
      "# Output style: Learning",
      "Work collaboratively so the user learns by doing. Share insights like the Explanatory style,",
      "and when a task contains a small piece of meaningful logic (2-10 lines: a design decision, a business rule, an edge case),",
      "leave a `TODO(human)` marker in the code at that spot and ask the user to write it.",
      "Format the request as a `● Learn by Doing` section that states the context, the exact file and function, and what to consider.",
      "Then stop and wait for the user's implementation before continuing. Only ever have one TODO(human) open at a time.",
    ].join("\n"),
  },
]

/** Built-ins, then ~/.claude/output-styles, then <project>/.claude/output-styles; later names win. */
export async function load(project: string, home = os.homedir()) {
  const found = [
    ...BUILTIN,
    ...(await readDir(path.join(home, ".claude", "output-styles"), "user")),
    ...(await readDir(path.join(project, ".claude", "output-styles"), "project")),
  ]
  return [...new Map(found.map((style) => [style.name.toLowerCase(), style])).values()]
}

/** `outputStyle` from the project's local settings, project settings, then user settings (Claude Code order). */
export async function current(project: string, home = os.homedir()) {
  const files = [
    path.join(project, ".claude", "settings.local.json"),
    path.join(project, ".claude", "settings.json"),
    path.join(home, ".claude", "settings.json"),
  ]
  for (const file of files) {
    const name = (await readJson(file)).outputStyle
    if (typeof name === "string" && name) return name
  }
  return "Default"
}

/** Saved per project in .claude/settings.local.json, which Claude Code reads too. */
export async function save(project: string, name: string) {
  const file = path.join(project, ".claude", "settings.local.json")
  await Bun.write(file, JSON.stringify({ ...(await readJson(file)), outputStyle: name }, null, 2) + "\n")
}

export function compose(system: string, style: Style) {
  if (!style.prompt) return system
  if (style.keepCodingInstructions) return `${system}\n\n${style.prompt}`
  return style.prompt
}

async function readDir(dir: string, source: Style["source"]) {
  const files = await Array.fromAsync(new Glob("*.md").scan({ cwd: dir, onlyFiles: true })).catch(() => [])
  return Promise.all(files.map(async (file) => parse(await Bun.file(path.join(dir, file)).text(), file, source)))
}

function parse(text: string, file: string, source: Style["source"]): Style {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const meta = (match ? Bun.YAML.parse(match[1]) : {}) as Record<string, unknown>
  return {
    name: typeof meta.name === "string" ? meta.name : path.basename(file, ".md"),
    description: typeof meta.description === "string" ? meta.description : "",
    source,
    keepCodingInstructions: meta["keep-coding-instructions"] === true,
    prompt: (match ? text.slice(match[0].length) : text).trim(),
  }
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return Bun.file(file)
    .json()
    .catch(() => ({}))
}
