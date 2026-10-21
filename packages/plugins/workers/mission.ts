#!/usr/bin/env bun
// Cheyenne C3: missions. One mission = one git worktree that every worker shares, a MISSION.md in it (goal,
// stage list, status), and an ordered stage template of {stage, workers, brief}. Each stage waits for the
// owner's approval by default; approving runs that stage's workers in parallel in a detached runner, so a run
// outlives the app and the server. State lives in ~/.cheyenne/missions/<id>.json (MISSION.md is rendered from
// it), worker output in ~/.cheyenne/missions/<id>/, and every change goes to `brain status`.
// Used by the plugin tools (index.ts), by the Command Center's Approve button (through ~/bin/cheyenne-mission),
// and from any terminal:  cheyenne-mission list [--json] | show <id> | approve <id>
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import { run, runWorker, tail, WORKER_NAMES, type Worker } from "./workers"

export type Status = "pending" | "waiting" | "running" | "done" | "failed"

export type Stage = {
  stage: string
  workers: Worker[]
  brief: string
  /** Wait for the owner's approval before this stage runs (default true). */
  pause?: boolean
  status: Status
  started?: string
  finished?: string
  /** Last lines of each worker's output, shared with the next stage through MISSION.md. */
  notes?: string
}

export type Mission = {
  id: string
  goal: string
  repo: string
  branch: string
  worktree: string
  business: string
  topic: string
  /** Standing rules every worker gets (naming, merge rules, skills to use). */
  rules?: string
  created: string
  /** The detached runner, while a stage runs. */
  pid?: number
  stages: Stage[]
}

// CHEYENNE_MISSIONS points the board at test missions (the Rooms screenshots: the cheyenne repo is public).
export const HOME = process.env.CHEYENNE_MISSIONS ?? join(homedir(), ".cheyenne", "missions")

const DESIGN = join(homedir(), "My Businesses", "Recode Design", "DESIGN-SYSTEM.md")

/** The owner's example flow; a mission can pass its own list. */
export const DEFAULT_STAGES: Omit<Stage, "status">[] = [
  {
    stage: "plan",
    workers: ["claude"],
    brief:
      "Write PLAN.md in this folder: the goal, what already exists that we build on, the approach, the files to " +
      "add or change, the work for each later stage (research + build, visuals/UX, verify) and how it will be " +
      "verified. Use the skills and research corpus the owner already has; do not re-research what exists. " +
      "Plan only: write no code. The owner approves PLAN.md before anything is built.",
  },
  {
    stage: "research + build",
    workers: ["grok", "cursor"],
    brief:
      "Follow PLAN.md. grok: research only the gaps PLAN.md names and write what you find, with sources, to " +
      "RESEARCH.md; touch no code. cursor: build the plan's code in this folder; read RESEARCH.md if it appears, " +
      "commit to this branch with clear messages.",
  },
  {
    stage: "visuals/UX",
    workers: ["codex"],
    brief:
      `Do the plan's visuals and UX against ${DESIGN} (read it first). Build on what the build stage made; ` +
      "commit to this branch.",
  },
  {
    stage: "verify",
    workers: ["claude"],
    brief:
      "Verify the work against PLAN.md: build it and run the repo's own gate scripts and tests. Write VERIFY.md " +
      "with each check, the command and its result (pass/fail with evidence). Fix nothing silently: report.",
  },
]

const now = () => new Date().toISOString()

const file = (id: string) => join(HOME, `${id}.json`)

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)

export function load(id: string): Mission {
  if (!/^[a-z0-9-]+$/.test(id) || !existsSync(file(id))) throw new Error(`no mission "${id}"`)
  return JSON.parse(readFileSync(file(id), "utf8"))
}

const alive = (pid?: number) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The stage the mission is on: the first one not done. */
export const current = (mission: Mission) => mission.stages.find((stage) => stage.status !== "done")

export function list(): Mission[] {
  if (!existsSync(HOME)) return []
  return readdirSync(HOME)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const mission = load(basename(name, ".json"))
      // A runner that died (reboot, kill) leaves a stage "running" forever; show it as failed so it can be retried.
      const stage = current(mission)
      if (stage?.status === "running" && !alive(mission.pid)) {
        stage.status = "failed"
        stage.notes = (stage.notes ?? "") + "\n[runner gone]"
      }
      return mission
    })
    .sort((a, b) => b.created.localeCompare(a.created))
}

const icon: Record<Status, string> = { pending: "·", waiting: "⏸", running: "▶", done: "✓", failed: "✗" }

export function render(mission: Mission) {
  const lines = [
    `# Mission: ${mission.goal}`,
    "",
    `- id: \`${mission.id}\` · business: ${mission.business} · brain topic: \`${mission.topic}\``,
    `- repo: \`${mission.repo}\` · branch: \`${mission.branch}\``,
    `- worktree (every worker works here): \`${mission.worktree}\``,
    `- worker output: \`${join(HOME, mission.id)}/\``,
    `- status: ${summary(mission)}`,
    "",
    "Every worker shares this folder and this file. Read it first, then PLAN.md once it exists.",
    "Stages run only after the owner approves them in Cheyenne's Command Center (or `cheyenne-mission approve`).",
    "",
  ]
  if (mission.rules) lines.push("## Rules", "", mission.rules, "")
  lines.push("## Stages", "", "| # | Stage | Workers | Status |", "|---|---|---|---|")
  mission.stages.forEach((stage, index) =>
    lines.push(`| ${index + 1} | ${stage.stage} | ${stage.workers.join(" + ")} | ${icon[stage.status]} ${stage.status} |`),
  )
  mission.stages.forEach((stage, index) => {
    lines.push("", `### ${index + 1}. ${stage.stage} (${stage.workers.join(" + ")})`, "", stage.brief)
    if (stage.notes) lines.push("", "Result:", "", "```", stage.notes.trim(), "```")
  })
  return lines.join("\n") + "\n"
}

export function summary(mission: Mission) {
  const stage = current(mission)
  if (!stage) return "done: every stage finished"
  const index = mission.stages.indexOf(stage) + 1
  const of = `stage ${index}/${mission.stages.length} ${stage.stage}`
  if (stage.status === "waiting") return `${of} waits for the owner's approval`
  if (stage.status === "running") return `${of} running (${stage.workers.join(" + ")})`
  if (stage.status === "failed") return `${of} failed; retry or fix by hand`
  return of
}

// The latest state goes to the record, so the briefing and the Command Center show it.
async function record(mission: Mission) {
  const stage = current(mission)
  const args = ["brain", "status", "-b", mission.business, "-t", mission.topic]
  args.push(`Cheyenne mission "${mission.goal}" (${mission.worktree}, branch ${mission.branch}): ${summary(mission)}.`)
  if (!stage) args.push("--next", "Owner reviews the branch; merge it the repo's way")
  else if (stage.status === "waiting" || stage.status === "failed") {
    args.push("--next", `Approve stage "${stage.stage}" in Cheyenne's Command Center`)
    args.push("--blocked", `Owner: approve stage "${stage.stage}"`)
  } else args.push("--next", `Wait for stage "${stage.stage}" to finish`)
  await run(args, mission.worktree, undefined, () => {}).catch(() => {})
}

export async function save(mission: Mission, brain = true) {
  mkdirSync(join(HOME, mission.id), { recursive: true })
  writeFileSync(file(mission.id), JSON.stringify(mission, null, 2))
  writeFileSync(join(mission.worktree, "MISSION.md"), render(mission))
  if (brain) await record(mission)
}

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

/** Creates the worktree (branch mission/<id> from `base`, default the repo's main or current HEAD) and MISSION.md. */
export async function open(input: {
  goal: string
  repo: string
  business: string
  name?: string
  base?: string
  rules?: string
  stages?: Omit<Stage, "status">[]
}) {
  const repo = git(resolve(input.repo), "rev-parse", "--show-toplevel")
  const id = slug(input.name || input.goal)
  if (!id) throw new Error("mission name is empty")
  if (existsSync(file(id))) throw new Error(`mission "${id}" already exists`)
  const stages = input.stages?.length ? input.stages : DEFAULT_STAGES
  for (const stage of stages)
    for (const worker of stage.workers)
      if (!WORKER_NAMES.includes(worker)) throw new Error(`unknown worker "${worker}" (${WORKER_NAMES.join(", ")})`)

  const base =
    input.base ?? (spawnSync("git", ["rev-parse", "--verify", "-q", "main"], { cwd: repo }).status === 0 ? "main" : "HEAD")
  const branch = `mission/${id}`
  const worktree = join(homedir(), "missions", id)
  git(repo, "worktree", "add", "-b", branch, worktree, base)

  const mission: Mission = {
    id,
    goal: input.goal,
    repo,
    branch,
    worktree,
    business: input.business,
    topic: `mission-${id}`,
    rules: input.rules,
    created: now(),
    stages: stages.map((stage, index) => ({
      ...stage,
      pause: stage.pause ?? true,
      status: index === 0 && (stage.pause ?? true) ? "waiting" : "pending",
    })),
  }
  await save(mission)
  // A first stage with pause:false starts at once.
  if (mission.stages[0].status === "pending") start(mission.id)
  return mission
}

// Detached, so the run survives the caller (the app's main process or the server) and its 30-minute caps.
function start(id: string) {
  const log = openSync(join(HOME, id, "runner.log"), "a")
  spawn(process.execPath, [import.meta.filename, "run", id], { detached: true, stdio: ["ignore", log, log] }).unref()
}

/** The owner's go for the current stage (also retries a failed one). */
export async function approve(id: string) {
  const mission = list().find((item) => item.id === id) ?? load(id)
  const stage = current(mission)
  if (!stage) throw new Error("every stage is done")
  if (stage.status === "running") throw new Error(`stage "${stage.stage}" is already running`)
  stage.status = "pending"
  await save(mission, false)
  start(id)
  return stage.stage
}

function brief(mission: Mission, stage: Stage, worker: Worker) {
  const index = mission.stages.indexOf(stage) + 1
  return [
    `Mission: ${mission.goal}`,
    `You are ${worker}, a worker on this mission: stage ${index}/${mission.stages.length} "${stage.stage}"` +
      (stage.workers.length > 1 ? `, in parallel with ${stage.workers.filter((w) => w !== worker).join(" + ")}.` : "."),
    `Every worker shares this folder (${mission.worktree}, a git worktree of ${mission.repo} on branch ${mission.branch}). ` +
      "Read MISSION.md first, and PLAN.md if it exists.",
    mission.rules ? `Rules:\n${mission.rules}` : "",
    `Your brief:\n${stage.brief}`,
    "Never merge, push or install. Work only in this folder. End with a short summary of what you did and what is left.",
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** The runner: runs stages from the current one until one needs approval, fails, or the mission ends. */
async function runStages(id: string) {
  const mission = load(id)
  for (let stage = current(mission); stage; stage = current(mission)) {
    if (stage.status !== "pending") return
    mission.pid = process.pid
    stage.status = "running"
    stage.started = now()
    await save(mission)
    const index = mission.stages.indexOf(stage) + 1
    const results = await Promise.all(
      stage.workers.map(async (worker) => {
        const out = join(HOME, id, `${index}-${slug(stage.stage)}-${worker}.log`)
        const result = await runWorker({
          worker,
          brief: brief(mission, stage, worker),
          dir: mission.worktree,
          business: mission.business,
          topic: mission.topic,
          onData: (_, output) => writeFileSync(out, output),
        })
        return { worker, ...result }
      }),
    )
    stage.finished = now()
    stage.notes = results.map((r) => `[${r.worker} ${r.status} in ${r.seconds}s]\n${tail(r.output.trim(), 1500)}`).join("\n\n")
    stage.status = results.every((r) => r.code === 0) ? "done" : "failed"
    mission.pid = undefined
    const next = current(mission)
    if (stage.status === "done" && next) next.status = next.pause === false ? "pending" : "waiting"
    await save(mission)
  }
}

if (import.meta.main) {
  const [command, id] = process.argv.slice(2)
  const show = (mission: Mission) => `${mission.id}  ${summary(mission)}\n  ${mission.goal}\n  ${mission.worktree}`
  try {
    if (command === "list" && id === "--json") console.log(JSON.stringify(list()))
    else if (command === "list") console.log(list().map(show).join("\n\n") || "no missions")
    else if (command === "show" && id) console.log(render(load(id)))
    else if (command === "approve" && id) console.log(`approved: ${await approve(id)}`)
    else if (command === "run" && id) await runStages(id)
    else {
      console.error("usage: cheyenne-mission list [--json] | show <id> | approve <id>")
      process.exit(2)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
