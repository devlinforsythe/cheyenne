// bun test (in this folder): the rooms' parsing and routing, offline (no agent runs), and the Pipeline's one write
// (`idea doing`) against a temp copy of the inbox, so ~/My Businesses is never edited.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const temp = mkdtempSync(join(tmpdir(), "cheyenne-rooms-"))
process.env.CHEYENNE_ROOMS = join(temp, "rooms")
process.env.CHEYENNE_IDEA_HOME = temp
const rooms = await import("./rooms")

test("a mission's column is the role of the stage it is on", () => {
  const columns = ["plan", "research + build", "visuals/UX", "verify", "explain the API"].map((stage) =>
    rooms.column({ stage }),
  )
  expect(columns).toEqual(["planner", "builder", "builder", "reviewer", "builder"])
  expect(rooms.column(undefined)).toBe("done")
})

test("the judge's verdict is its first PASS / FAIL line; none is a FAIL", () => {
  expect(rooms.verdict("**PASS**\nall three points hold").verdict).toBe("PASS")
  expect(rooms.verdict("Looking at it.\nVerdict: FAIL\nno test").verdict).toBe("FAIL")
  expect(rooms.verdict("FAILED: the README is missing").verdict).toBe("FAIL")
  const none = rooms.verdict("looks fine to me")
  expect(none.verdict).toBe("FAIL")
  expect(none.feedback).toStartWith("no verdict: ")
})

test("@-tags pick who replies, else everyone present, in roster order", () => {
  expect(rooms.responders("thoughts?", ["grok", "claude"])).toEqual(["claude", "grok"])
  expect(rooms.responders("@Hermes and @codex: you two", ["claude"])).toEqual(["codex", "hermes"])
  expect(rooms.responders("hello", [])).toEqual([])
})

test("owed lists each owner message's missing replies, oldest first", () => {
  const lines = [
    { text: "", at: "" }, // header
    { from: "owner", text: "a", at: "", to: ["claude", "codex"] as const },
    { from: "claude", text: "hi", at: "", re: 1 },
    { from: "owner", text: "b", at: "", to: ["grok"] as const },
  ]
  expect(rooms.owed(lines as any)).toEqual([
    { re: 1, agent: "codex" },
    { re: 3, agent: "grok" },
  ])
})

test("a plan parses from fenced JSON and is checked", () => {
  const good = rooms.parsePlan(
    'Here:\n```json\n{"route":"action","business":"infra","title":"t","repo":"","why":"w",' +
      '"stages":[{"stage":"build","workers":["cursor"],"brief":"do it"}]}\n```',
    "recode",
  )
  expect("plan" in good && good.plan.stages.length).toBe(1)
  expect("plan" in good && good.plan.repo).toBe(join(homedir(), "My Businesses"))
  const worker = rooms.parsePlan('{"route":"action","stages":[{"stage":"x","workers":["gpt"],"brief":"y"}]}', "recode")
  expect("error" in worker && worker.error).toContain('unknown worker "gpt"')
  expect("error" in rooms.parsePlan("no json here", "recode")).toBe(true)
  const reference = rooms.parsePlan('{"route":"reference","business":"nope","stages":[]}', "recode")
  expect("plan" in reference && reference.plan.business).toBe("recode")
})

test("the Pipeline lists open ideas and promotes one in the temp inbox only", () => {
  const real = join(homedir(), "My Businesses", "ideas", "inbox.jsonl")
  const before = readFileSync(real, "utf8")
  const inbox = join(temp, "My Businesses", "ideas", "inbox.jsonl")
  mkdirSync(join(temp, "My Businesses", "ideas"), { recursive: true })
  const row = (id: string, status: string) => JSON.stringify({ id, business: "infra", idea: `idea ${id}`, status })
  writeFileSync(inbox, [row("20261020-aaaa", "inbox"), row("20261020-bbbb", "done"), row("20261020-cccc", "parked")].join("\n") + "\n")
  expect(rooms.ideas().map((idea) => idea.id)).toEqual(["20261020-cccc", "20261020-aaaa"])
  expect(rooms.promote("20261020-aaaa")).toBe("")
  expect(readFileSync(inbox, "utf8")).toContain('"status": "doing"')
  expect(rooms.promote("20261020-zzzz")).toContain("no idea matching")
  expect(readFileSync(real, "utf8")).toBe(before)
})
