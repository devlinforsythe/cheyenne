#!/usr/bin/env bun
// Cheyenne rooms (the owner's pick, 2026-10-20): Agent Kanban, Loop, Pipeline and Mastermind, drawn by the Rooms side
// tab (packages/gui-extensions/src/rooms). Our own code: Agent OS (~/agent-os) was read for behaviour only.
// - Kanban: the missions (mission.ts) as a planner / builder / reviewer board; a new card opens a mission.
// - Loop: a builder works in a mission's worktree, a different model judges it read-only against a written
//   definition of done, round after round until PASS, the round limit, or Stop.
// - Pipeline: an idea from the ideas inbox is classified and planned by a read-only agent; the owner approves once,
//   which runs `idea doing <id>` and opens a mission whose stages all run without pausing.
// - Mastermind: one group chat where claude, codex, grok and hermes reply in turn (read-only) and can be @-tagged.
// Long jobs run in a detached runner (`cheyenne-rooms <room> run <id>`), so they outlive the app. State is JSON under
// ~/.cheyenne/rooms (CHEYENNE_ROOMS overrides it; CHEYENNE_IDEA_HOME is the home whose ideas inbox the Pipeline uses).
// Every command prints JSON:
//   cheyenne-rooms state [chat id] | board | kanban new '<json>'   (state = every room plus one chat: the Rooms tab's poll)
//   cheyenne-rooms loop list | start '<json>' | stop <id>
//   cheyenne-rooms pipeline list | shape <id> [agent] | approve <id> '<json>' | reject <id>
//   cheyenne-rooms chat list | show <id> | new '<json>' | say <id> '<json>'
import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { redact } from "../agent-sessions/common"
import { current, list, load, open, summary, type Stage } from "./mission"
import { run, runWorker, tail, WORKER_NAMES, type Worker } from "./workers"

export const ROOMS = process.env.CHEYENNE_ROOMS ?? join(homedir(), ".cheyenne", "rooms")

const IDEA_HOME = process.env.CHEYENNE_IDEA_HOME ?? homedir()

const INBOX = join(IDEA_HOME, "My Businesses", "ideas", "inbox.jsonl")

// Where read-only agents start (they see the businesses' CLAUDE.md / AGENTS.md) and new missions default.
const BUSINESSES = join(homedir(), "My Businesses")

// Read-only answers for the judge, the planner and the Mastermind (each CLI's --help checked 2026-10-20). hermes -z
// auto-approves its tools, so -t web keeps it to the web toolset; its MCP servers may still load.
export const READERS = {
  claude: ["claude", "-p", "--permission-mode", "plan"],
  codex: ["codex", "exec", "-m", "gpt-5.6-sol", "--sandbox", "read-only", "--skip-git-repo-check"],
  grok: ["grok", "--permission-mode", "plan", "-p"],
  hermes: ["hermes", "-t", "web", "-z"],
} as const

export type Agent = keyof typeof READERS

export const AGENTS = Object.keys(READERS) as Agent[]

const now = () => new Date().toISOString()

const file = (room: string, id: string, ext = "json") => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`bad id "${id}"`)
  mkdirSync(join(ROOMS, room), { recursive: true })
  return join(ROOMS, room, `${id}.${ext}`)
}

const read = <T>(room: string, id: string): T | undefined =>
  existsSync(file(room, id)) ? JSON.parse(readFileSync(file(room, id), "utf8")) : undefined

const write = (room: string, id: string, value: unknown) => writeFileSync(file(room, id), JSON.stringify(value, null, 2))

const ids = (room: string, ext = ".json") =>
  existsSync(join(ROOMS, room))
    ? readdirSync(join(ROOMS, room))
        .filter((name) => name.endsWith(ext))
        .map((name) => name.slice(0, -ext.length))
    : []

const alive = (pid?: number) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Detached, like the mission runner: the job outlives the app, and leads its own process group (so Stop reaches its
// children too).
const detach = (room: string, id: string) => {
  const log = openSync(file(room, id, "log"), "a")
  const child = spawn(process.execPath, [import.meta.filename, room, "run", id], { detached: true, stdio: ["ignore", log, log] })
  child.unref()
  return child.pid
}

const expand = (path?: string) => path?.trim().replace(/^~(?=\/|$)/, homedir())

const brain = (args: string[], cwd = homedir()) => run(["brain", ...args], cwd, undefined, () => {}).catch(() => 1)

const businesses = (): string[] => {
  try {
    return Object.keys(JSON.parse(readFileSync(join(homedir(), "brain", "brain.json"), "utf8")).businesses)
  } catch {
    return []
  }
}

/** One read-only answer: stdout is the reply (codex logs to stderr); a failure keeps the tail of what it printed. */
async function ask(agent: Agent, prompt: string, cwd: string, minutes = 10) {
  let out = ""
  let err = ""
  const code = await run(
    [...READERS[agent], prompt],
    cwd,
    AbortSignal.timeout(minutes * 60_000),
    (text) => (out += text),
    (text) => (err += text),
  ).catch((error: Error) => ((err += `\n${error.message}`), -1))
  const text = out.trim()
  if (code === 0 && text) return { ok: true, text: redact(text) }
  return { ok: false, text: redact(tail(`${text}\n${err}`.trim() || `exit ${code}`, 1500)) }
}

// --- Kanban ----------------------------------------------------------------------------------------------------

export type Column = "planner" | "builder" | "reviewer" | "done"

/** A mission's board column: the role of the stage it is on. */
export const column = (stage?: Pick<Stage, "stage">): Column =>
  !stage
    ? "done"
    : /\bplan/i.test(stage.stage)
      ? "planner"
      : /\b(verify|review|judge|test|qa)/i.test(stage.stage)
        ? "reviewer"
        : "builder"

function board() {
  const cards = list().map((mission) => {
    const stage = current(mission)
    return {
      id: mission.id,
      goal: mission.goal,
      business: mission.business,
      column: column(stage),
      stage: stage?.stage ?? "",
      status: stage?.status ?? "done",
      workers: stage?.workers ?? [],
      summary: summary(mission),
    }
  })
  return { cards, businesses: businesses(), workers: WORKER_NAMES, agents: AGENTS }
}

/** A new card is a new mission on the default stages; each stage still waits for the owner's Approve. */
async function newCard(input: { goal?: string; business?: string; repo?: string }) {
  const goal = input.goal?.trim()
  if (!goal || !input.business) throw new Error("a card needs a goal and a business")
  const mission = await open({ goal, business: input.business, repo: expand(input.repo) || BUSINESSES })
  return { id: mission.id }
}

// --- Loop ------------------------------------------------------------------------------------------------------

type Round = { round: number; builder: string; seconds: number; verdict: "PASS" | "FAIL"; feedback: string }

type Loop = {
  id: string
  mission: string
  worktree: string
  business: string
  topic: string
  done: string
  builder: Worker
  judge: Agent
  rounds: number
  status: "running" | "passed" | "failed" | "stopped"
  pid?: number
  created: string
  finished?: string
  note?: string
  history: Round[]
}

const VERDICT = /^(?:verdict\s*:?\s*)?(PASS|FAIL)(?:ED)?\b/i

/** The judge's verdict: its first line that starts with PASS or FAIL (markdown marks ignored); none is a FAIL. */
export function verdict(text: string): Pick<Round, "verdict" | "feedback"> {
  const found = text
    .split("\n")
    .map((line) => VERDICT.exec(line.replace(/[*_`#>]/g, "").trim()))
    .find(Boolean)
  const feedback = tail(text.trim(), 2000)
  if (!found) return { verdict: "FAIL", feedback: `no verdict: ${feedback}` }
  return { verdict: found[1].toUpperCase() === "PASS" ? "PASS" : "FAIL", feedback }
}

function loops(): Loop[] {
  return ids("loop")
    .map((id) => {
      const loop = read<Loop>("loop", id)!
      if (loop.status === "running" && !alive(loop.pid)) Object.assign(loop, { status: "failed", note: "runner gone" })
      return loop
    })
    .sort((a, b) => b.created.localeCompare(a.created))
}

function startLoop(input: { mission?: string; done?: string; builder?: string; judge?: string; rounds?: number }) {
  const mission = load(input.mission ?? "")
  const done = input.done?.trim()
  const builder = (input.builder ?? "claude") as Worker
  const judge = (input.judge ?? "codex") as Agent
  if (!done) throw new Error("write the definition of done first")
  if (!WORKER_NAMES.includes(builder)) throw new Error(`unknown builder "${builder}"`)
  if (!AGENTS.includes(judge)) throw new Error(`unknown judge "${judge}"`)
  if ((judge as string) === builder) throw new Error("the judge must be a different model from the builder")
  if (current(mission)?.status === "running") throw new Error(`mission "${mission.id}" has a stage running`)
  if (loops().some((loop) => loop.mission === mission.id && loop.status === "running"))
    throw new Error(`a loop already runs on "${mission.id}"`)
  const loop: Loop = {
    id: `${mission.id}-${Date.now().toString(36)}`,
    mission: mission.id,
    worktree: mission.worktree,
    business: mission.business,
    topic: mission.topic,
    done,
    builder,
    judge,
    rounds: Math.min(8, Math.max(1, Math.round(Number(input.rounds) || 4))),
    status: "running",
    created: now(),
    history: [],
  }
  write("loop", loop.id, loop)
  write("loop", loop.id, { ...loop, pid: detach("loop", loop.id) })
  return { id: loop.id }
}

function stopLoop(id: string) {
  const loop = read<Loop>("loop", id)
  if (!loop) throw new Error(`no loop "${id}"`)
  if (loop.status !== "running") return { id, status: loop.status }
  // Kill first, so the runner cannot write after "stopped".
  if (loop.pid && alive(loop.pid)) process.kill(-loop.pid, "SIGTERM")
  write("loop", id, { ...loop, status: "stopped", finished: now(), pid: undefined })
  return { id, status: "stopped" }
}

const judgePrompt = (loop: Loop, round: number, output: string) => {
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: loop.worktree, encoding: "utf8" }).stdout?.trim() || "(nothing)"
  return [
    `You are the judge of a Cheyenne loop, round ${round} of ${loop.rounds}. A different model (${loop.builder}) is ` +
      `the builder in ${loop.worktree}. You are read-only: inspect the files and the git history, change nothing.`,
    `Definition of done:\n${loop.done}`,
    `git status --short:\n${git("status", "--short")}`,
    `git log --oneline -5:\n${git("log", "--oneline", "-5")}`,
    `The builder's last output:\n${tail(output.trim(), 4000)}`,
    "Check the work against every point of the definition of done. Put PASS or FAIL alone on the first line, then " +
      "the reasons; on FAIL, say exactly what is still missing.",
  ].join("\n\n")
}

/** The runner: build, judge, repeat with the judge's feedback until PASS, a failure, the limit, or Stop. */
async function runLoop(id: string) {
  const get = () => read<Loop>("loop", id)!
  let loop = get()
  for (let round = loop.history.length + 1; loop.status === "running" && round <= loop.rounds; round++) {
    const last = loop.history.at(-1)
    const built = await runWorker({
      worker: loop.builder,
      dir: loop.worktree,
      business: loop.business,
      topic: loop.topic,
      brief: [
        `You are the builder of a Cheyenne loop, round ${round} of ${loop.rounds}, in ${loop.worktree} (a mission ` +
          "worktree: commit to its branch). A different model judges your work after each round.",
        `Definition of done:\n${loop.done}`,
        last ? `The judge failed round ${last.round}:\n${last.feedback}` : "",
        "Work until the definition of done holds, then end with a short summary. Never merge, push or install.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      onData: (_, output) => writeFileSync(file("loop", `${id}-${round}`, "out"), output),
    })
    const judged = built.code === 0 ? await ask(loop.judge, judgePrompt(loop, round, built.output), loop.worktree) : undefined
    loop = get()
    if (loop.status !== "running") return // stopped meanwhile
    // A broken builder or judge ends the loop instead of burning the rounds that are left.
    if (!judged?.ok) {
      const failed = judged ? `judge ${loop.judge}` : `builder ${loop.builder} ${built.status}`
      Object.assign(loop, { status: "failed", note: `${failed}: ${judged?.text ?? tail(built.output.trim(), 600)}` })
    } else {
      const result = verdict(judged.text)
      loop.history.push({ round, builder: built.status, seconds: built.seconds, ...result })
      if (result.verdict === "PASS") loop.status = "passed"
      else if (round === loop.rounds) Object.assign(loop, { status: "failed", note: `no PASS in ${loop.rounds} rounds` })
    }
    if (loop.status !== "running") Object.assign(loop, { finished: now(), pid: undefined })
    write("loop", id, loop)
  }
  await brain(
    [
      "log",
      "-b",
      loop.business,
      "-t",
      loop.topic,
      `Cheyenne loop ${loop.id}: ${loop.status} after ${loop.history.length}/${loop.rounds} rounds (builder ` +
        `${loop.builder}, judge ${loop.judge})${loop.note ? `; ${loop.note.slice(0, 200)}` : ""}. Done = ${loop.done.slice(0, 200)}`,
    ],
    loop.worktree,
  )
}

// --- Pipeline --------------------------------------------------------------------------------------------------

type Idea = { id: string; created?: string; business: string; project?: string; idea: string; status: string }

export type Plan = {
  route: "project" | "action" | "reference" | "drop"
  business: string
  title: string
  repo: string
  why: string
  stages: Omit<Stage, "status">[]
}

type Shaped = {
  id: string
  stage: "shaping" | "review" | "approved" | "rejected" | "failed"
  planner: Agent
  plan?: Plan
  mission?: string
  error?: string
  pid?: number
  updated: string
}

const ROUTES = ["project", "action", "reference", "drop"]

// The idea CLI is the inbox's only writer; this only reads it.
const inbox = (): Idea[] =>
  readFileSync(INBOX, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))

/** Open ideas (inbox, parked) plus the ones the Pipeline promoted to a mission, newest first. */
export function ideas() {
  return inbox()
    .filter((idea) => /^[a-z0-9-]+$/.test(idea.id))
    .flatMap((idea) => {
      const shaped = read<Shaped>("pipeline", idea.id)
      const promoted = shaped?.stage === "approved" && idea.status === "doing"
      if (!promoted && !["inbox", "parked"].includes(idea.status)) return []
      if (shaped?.stage === "shaping" && !alive(shaped.pid)) Object.assign(shaped, { stage: "failed", error: "runner gone" })
      return [
        {
          id: idea.id,
          idea: idea.idea,
          business: idea.business,
          project: idea.project ?? "",
          status: idea.status,
          stage: shaped?.stage ?? "new",
          planner: shaped?.planner,
          plan: shaped?.plan,
          mission: shaped?.mission,
          error: shaped?.error,
        },
      ]
    })
    .reverse()
}

/** The planner's JSON (from its first "{" to its last "}"), checked. A bad answer becomes an error to show. */
export function parsePlan(text: string, business: string): { plan: Plan } | { error: string } {
  try {
    const raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))
    if (!ROUTES.includes(raw.route)) throw new Error(`route "${raw.route}"`)
    const stages = (Array.isArray(raw.stages) ? raw.stages : []).map((stage: any) => ({
      stage: String(stage?.stage ?? "").trim(),
      workers: Array.isArray(stage?.workers) ? stage.workers : [],
      brief: String(stage?.brief ?? "").trim(),
    }))
    for (const stage of stages) {
      if (!stage.stage || !stage.brief || !stage.workers.length) throw new Error("a stage needs a name, a brief and workers")
      for (const worker of stage.workers) if (!WORKER_NAMES.includes(worker)) throw new Error(`unknown worker "${worker}"`)
    }
    const builds = raw.route === "project" || raw.route === "action"
    if (builds && (stages.length < 1 || stages.length > 6)) throw new Error(`${stages.length} stages (1 to 6)`)
    const known = businesses()
    return {
      plan: {
        route: raw.route,
        business: raw.business && (!known.length || known.includes(raw.business)) ? String(raw.business) : business,
        title: String(raw.title ?? "").trim(),
        repo: expand(String(raw.repo || "")) || BUSINESSES,
        why: String(raw.why ?? "").trim(),
        stages: builds ? stages : [],
      },
    }
  } catch (error) {
    return { error: `the plan did not parse (${error instanceof Error ? error.message : error}): ${tail(text.trim(), 1000)}` }
  }
}

const planPrompt = (idea: Idea) =>
  [
    "You shape one idea from the owner's ideas inbox into a plan for Cheyenne's agents. You are read-only: read " +
      "what you need, change nothing.",
    `Idea ${idea.id} (business ${idea.business}${idea.project ? `, project ${idea.project}` : ""}):\n${idea.idea}`,
    `Businesses: ${businesses().join(", ")}. Workers: ${WORKER_NAMES.join(", ")} (claude plans and verifies, cursor ` +
      "builds code, codex does visuals and UX, grok researches).",
    `The default repo is ${BUSINESSES}; name another git repo only when the idea's code lives there.`,
    'Answer with one JSON object and nothing else: {"route": "project" | "action" | "reference" | "drop", ' +
      '"business": "...", "title": "a short mission name", "repo": "an absolute path", "why": "one or two ' +
      'sentences", "stages": [{"stage": "...", "workers": ["..."], "brief": "..."}]}',
    "route: project = a build in several stages, action = one small job, reference = keep it as information, drop = " +
      "not worth doing. A project or action has 1 to 6 stages (the first plans, the last verifies); reference and " +
      "drop have none.",
  ].join("\n\n")

function shape(id: string, planner = "claude") {
  if (!inbox().some((idea) => idea.id === id)) throw new Error(`no idea "${id}"`)
  if (!AGENTS.includes(planner as Agent)) throw new Error(`unknown planner "${planner}"`)
  const shaped = read<Shaped>("pipeline", id)
  if (shaped?.stage === "shaping" && alive(shaped.pid)) throw new Error(`idea "${id}" is being shaped`)
  if (shaped?.stage === "approved") throw new Error(`idea "${id}" is already mission "${shaped.mission}"`)
  const next: Shaped = { id, stage: "shaping", planner: planner as Agent, updated: now() }
  write("pipeline", id, next)
  write("pipeline", id, { ...next, pid: detach("pipeline", id) })
  return { id, stage: next.stage }
}

async function runShape(id: string) {
  const shaped = read<Shaped>("pipeline", id)!
  const idea = inbox().find((item) => item.id === id)!
  const answer = await ask(shaped.planner, planPrompt(idea), BUSINESSES)
  const result = answer.ok ? parsePlan(answer.text, idea.business) : { error: `${shaped.planner}: ${answer.text}` }
  const outcome = "plan" in result ? { stage: "review", plan: result.plan, error: undefined } : { stage: "failed", error: result.error }
  write("pipeline", id, { ...read<Shaped>("pipeline", id), ...outcome, pid: undefined, updated: now() })
}

/** `idea doing <id>` against IDEA_HOME's inbox. Returns its error, or "" when it worked. */
export function promote(id: string) {
  const result = spawnSync("idea", ["doing", id], { env: { ...process.env, HOME: IDEA_HOME }, encoding: "utf8" })
  return result.status === 0 ? "" : (result.stderr?.trim() || result.error?.message || `exit ${result.status}`)
}

/** The owner's one approval: the idea becomes "doing" and a mission whose stages all run without pausing, from now. */
async function approveIdea(id: string, input: { repo?: string }) {
  const shaped = read<Shaped>("pipeline", id)
  const idea = inbox().find((item) => item.id === id)
  if (!idea || shaped?.stage !== "review" || !shaped.plan) throw new Error(`idea "${id}" has no plan waiting`)
  if (!shaped.plan.stages.length) throw new Error(`a "${shaped.plan.route}" plan has nothing to build`)
  const mission = await open({
    goal: idea.idea,
    repo: expand(input.repo) || shaped.plan.repo,
    business: shaped.plan.business,
    name: shaped.plan.title,
    stages: shaped.plan.stages.map((stage) => ({ ...stage, pause: false })),
  })
  const failed = promote(id)
  write("pipeline", id, { ...shaped, stage: "approved", mission: mission.id, error: failed || undefined, updated: now() })
  await brain([
    "log",
    "-b",
    mission.business,
    "-t",
    mission.topic,
    `Cheyenne pipeline: the owner approved idea ${id} ("${idea.idea.slice(0, 120)}") as mission ${mission.id}, ` +
      `${mission.stages.length} stages without pauses; ${failed ? `idea doing failed: ${failed}` : "idea marked doing"}.`,
  ])
  return { id, mission: mission.id }
}

function reject(id: string) {
  const shaped = read<Shaped>("pipeline", id)
  if (!shaped || shaped.stage === "approved" || shaped.stage === "shaping") throw new Error(`idea "${id}" has no plan to reject`)
  write("pipeline", id, { ...shaped, stage: "rejected", updated: now() })
  return { id, stage: "rejected" }
}

// --- Mastermind ------------------------------------------------------------------------------------------------
// chat/<id>.jsonl is append-only: line 0 is {title, created, present}, then the owner's messages {from: "owner",
// text, at, to, present} and the replies {from, text, at, re, error?} (re = the line of the message answered), so the
// owner's sends and the runner's replies never overwrite each other. chat/<id>.lock holds the one runner {pid, typing}.

type Line = { from?: string; text: string; at: string; to?: Agent[]; present?: Agent[]; re?: number; error?: boolean }

const MENTION = new RegExp(`@(${AGENTS.join("|")})\\b`, "gi")

/** Who answers a message: the agents it @-tags (they join the chat), else everyone present; in roster order. */
export function responders(text: string, present: readonly string[]) {
  const tagged = new Set([...text.matchAll(MENTION)].map((match) => match[1].toLowerCase()))
  return AGENTS.filter((agent) => (tagged.size ? tagged.has(agent) : present.includes(agent)))
}

/** The replies still owed, oldest first: each owner message's responders that have not answered it. */
export function owed(lines: readonly Line[]) {
  const answered = new Set(lines.filter((line) => line.re !== undefined).map((line) => `${line.re}:${line.from}`))
  return lines.flatMap((line, re) =>
    line.from === "owner" ? (line.to ?? []).filter((agent) => !answered.has(`${re}:${agent}`)).map((agent) => ({ re, agent })) : [],
  )
}

const lines = (id: string): Line[] =>
  readFileSync(file("chat", id, "jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const holder = (id: string): { pid?: number; typing?: Agent } => {
  try {
    return JSON.parse(readFileSync(file("chat", id, "lock"), "utf8"))
  } catch {
    return {}
  }
}

function chat(id: string) {
  if (!existsSync(file("chat", id, "jsonl"))) throw new Error(`no chat "${id}"`)
  const all = lines(id)
  const [head, ...messages] = all as [Line & { title: string; created: string; present: Agent[] }, ...Line[]]
  const runner = holder(id)
  return {
    id,
    title: head.title || messages.find((line) => line.from === "owner")?.text.slice(0, 60) || "New chat",
    updated: messages.at(-1)?.at ?? head.created,
    present: messages.findLast((line) => line.present)?.present ?? head.present,
    messages: messages.map(({ from = "", text, at, error }) => ({ from, text, at, error })),
    pending: [...new Set(owed(all).map((job) => job.agent))],
    typing: alive(runner.pid) ? runner.typing : undefined,
  }
}

const chats = () =>
  ids("chat", ".jsonl")
    .map((id) => {
      const { title, updated, messages } = chat(id)
      return { id, title, updated, count: messages.length }
    })
    .sort((a, b) => b.updated.localeCompare(a.updated))

function newChat(input: { present?: string[] }) {
  const id = `chat-${Date.now().toString(36)}`
  const present = AGENTS.filter((agent) => (input.present ?? AGENTS).includes(agent))
  writeFileSync(file("chat", id, "jsonl"), JSON.stringify({ title: "", created: now(), present }) + "\n", { flag: "wx" })
  return { id }
}

function say(id: string, input: { text?: string; present?: string[] }) {
  const text = input.text?.trim()
  if (!text) throw new Error("say something first")
  const before = input.present ?? chat(id).present
  const to = responders(text, before)
  if (!to.length) throw new Error("nobody is in the chat: add an agent or @-tag one")
  const present = AGENTS.filter((agent) => before.includes(agent) || to.includes(agent))
  appendFileSync(file("chat", id, "jsonl"), JSON.stringify({ from: "owner", text, at: now(), to, present }) + "\n")
  detach("chat", id) // exits at once when another runner holds the chat
  return { id, to }
}

const chatPrompt = (all: readonly Line[], job: { re: number; agent: Agent }) => {
  const transcript = all
    .slice(1)
    .filter((line) => !line.error)
    .map((line) => `[${line.from}] ${line.text}`)
    .join("\n\n")
  return [
    `You are ${job.agent}, one of the owner's AI agents (${AGENTS.join(", ")}) in a group chat called the Mastermind. ` +
      "The agents reply in turn and see each other's replies: build on them or disagree, don't repeat them.",
    "You are read-only here: answer in the chat; don't edit files or run anything that changes state.",
    `The chat so far:\n\n${tail(transcript, 24_000)}`,
    `Reply now as ${job.agent} to the owner's message "${tail(all[job.re].text, 2000)}". Keep it short and conversational.`,
  ].join("\n\n")
}

/** The runner: answers owed replies one at a time, in order, until none is left. One runner per chat (the lock). */
async function runChat(id: string) {
  const lock = file("chat", id, "lock")
  const take = (): boolean => {
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: "wx" })
      return true
    } catch {
      if (alive(holder(id).pid)) return false
      // ponytail: a stale lock (its runner died) taken over by two fresh runners at once can race; duplicate replies at worst.
      rmSync(lock, { force: true })
      return take()
    }
  }
  if (!take()) return
  try {
    for (;;) {
      const all = lines(id)
      const job = owed(all)[0]
      if (!job) {
        rmSync(lock, { force: true })
        // A message that landed after the read above: answer it, unless a newer runner already holds the chat.
        if (owed(lines(id)).length && take()) continue
        return
      }
      writeFileSync(lock, JSON.stringify({ pid: process.pid, typing: job.agent }))
      const answer = await ask(job.agent, chatPrompt(all, job), BUSINESSES, 5)
      const reply = { from: job.agent, text: answer.text, at: now(), re: job.re, ...(answer.ok ? {} : { error: true }) }
      appendFileSync(file("chat", id, "jsonl"), JSON.stringify(reply) + "\n")
    }
  } finally {
    if (holder(id).pid === process.pid) rmSync(lock, { force: true })
  }
}

// --- CLI -------------------------------------------------------------------------------------------------------

if (import.meta.main) {
  const [room, command = "", a, b] = process.argv.slice(2)
  const json = (text?: string) => (text ? JSON.parse(text) : {})
  const commands: Record<string, () => unknown> = {
    // ponytail: one read of every room per poll, plus one open chat (the id given, else the newest); split it per room
    // if it ever gets slow.
    state: () => {
      const all = chats()
      const shown = all.find((item) => item.id === (command || all[0]?.id))
      return { ...board(), loops: loops(), ideas: ideas(), chats: all, chat: shown && chat(shown.id) }
    },
    board: () => board(),
    "kanban new": () => newCard(json(a)),
    "loop list": () => loops(),
    "loop start": () => startLoop(json(a)),
    "loop stop": () => stopLoop(a),
    "loop run": () => runLoop(a),
    "pipeline list": () => ideas(),
    "pipeline shape": () => shape(a, b),
    "pipeline approve": () => approveIdea(a, json(b)),
    "pipeline reject": () => reject(a),
    "pipeline run": () => runShape(a),
    "chat list": () => chats(),
    "chat show": () => chat(a),
    "chat new": () => newChat(json(a)),
    "chat say": () => say(a, json(b)),
    "chat run": () => runChat(a),
  }
  const action = commands[`${room} ${command}`] ?? commands[room]
  try {
    if (!action) throw new Error("usage: cheyenne-rooms state | board | kanban new | loop … | pipeline … | chat … (see rooms.ts)")
    const out = await action()
    if (out !== undefined) console.log(JSON.stringify(out))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
