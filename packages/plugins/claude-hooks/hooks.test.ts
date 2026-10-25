// bun test (in this folder): Claude Code's matcher rules and the block / allow decision, plus one real hook run
// from a temp project's .claude/settings.local.json (the PreToolUse guard shape used in docs/hooks-proof).
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { claudeInput, claudeTool, decide, matches, runHooks } from "./hooks"

test("matchers: empty and * match all, name lists are exact, the rest is a regex", () => {
  expect(matches(undefined, "Bash")).toBe(true)
  expect(matches("*", "Bash")).toBe(true)
  expect(matches("Edit|Write", "Write")).toBe(true)
  expect(matches("Edit|Write", "WriteFile")).toBe(false)
  expect(matches("^(startup|resume)$", "startup")).toBe(true)
  expect(matches("mcp__.*|WebFetch", "Bash")).toBe(false)
  expect(matches("Bash", undefined)).toBe(false)
  expect(claudeTool("shell")).toBe("Bash")
  expect(claudeTool("run_worker")).toBe("run_worker")
  expect(claudeInput({ filePath: "/a", oldString: "x" })).toEqual({ file_path: "/a", old_string: "x" })
})

test("exit 2 and JSON denials block with the reason; exit 0 stdout is context; other exits are ignored", () => {
  expect(decide(2, "", "no rm -rf\n")).toEqual({ block: "no rm -rf" })
  expect(decide(0, '{"decision":"block","reason":"nope"}', "")).toEqual({ block: "nope" })
  expect(
    decide(0, '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"guarded"}}', ""),
  ).toEqual({ block: "guarded" })
  expect(decide(0, "briefing\n", "")).toEqual({ context: "briefing" })
  expect(decide(0, '{"hookSpecificOutput":{"additionalContext":"extra"}}', "")).toEqual({ context: "extra" })
  expect(decide(1, "", "crashed")).toEqual({})
})

test("a project PreToolUse guard blocks only the matching command and gets the hook JSON on stdin", async () => {
  const project = mkdtempSync(join(tmpdir(), "cheyenne-hooks-"))
  mkdirSync(join(project, ".claude"))
  const guard = `grep -q BLOCKME && { echo "guard: BLOCKME is not allowed" >&2; exit 2; } || exit 0`
  writeFileSync(
    join(project, ".claude", "settings.local.json"),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: guard }] }] } }),
  )
  const call = (tool: string, command: string) =>
    runHooks("PreToolUse", project, claudeTool(tool), { tool_name: claudeTool(tool), tool_input: { command } })
  expect((await call("shell", "echo BLOCKME")).block).toBe("guard: BLOCKME is not allowed")
  expect((await call("shell", "echo hi")).block).toBeUndefined()
  expect((await call("read", "BLOCKME")).block).toBeUndefined()
})
