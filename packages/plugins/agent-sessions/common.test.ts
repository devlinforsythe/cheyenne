// bun test (in this folder): the tokens redact() keeps out of the OpenCode database, built here so no scanner sees one,
// and the one import timer every() keeps however many copies of a plugin the server loads.
import { expect, test } from "bun:test"
import { every, redact } from "./common"

test("redact masks tokens, also after a newline, and leaves words ending in sk- alone", () => {
  const airtable = "pat" + "x".repeat(14) + "." + "a".repeat(64)
  const anthropic = "sk-ant-" + "y".repeat(40)
  const word = "task-" + "z".repeat(40)
  expect(redact({ text: `token ${airtable}\n${anthropic} ${word}` }).text).toBe(`token [redacted]\n[redacted] ${word}`)
})

test("every runs one timer for all loaded copies, the newest copy's run, until the last copy unloads", async () => {
  const calls: string[] = []
  const copy = (name: string) => every("test", 5, async () => void calls.push(name))
  const a = copy("a")
  const b = copy("b")
  await Bun.sleep(40)
  expect(calls).toEqual(["b"]) // two folders open: one run, by the newest copy
  const c = copy("c") // the files changed: the fresh copy takes the timer...
  a()
  b() // ...and keeps it while the old copies unload
  await Bun.sleep(40)
  expect(calls).toEqual(["b", "c"])
  const d = copy("d")
  c()
  d() // every copy unloaded: nothing runs
  await Bun.sleep(40)
  expect(calls).toEqual(["b", "c"])
})
