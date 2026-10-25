import { expect, test } from "bun:test"
import { ansi, payload } from "./line"

test("payload matches Claude Code's status line input", () => {
  const parsed = JSON.parse(
    payload({
      sessionID: "ses_1",
      directory: "/work/app/src",
      project: "/work/app",
      model: { id: "claude-opus-5-5", name: "Opus 5.5" },
      cost: 0.25,
      tokens: { input: 40_000, output: 10_000 },
      limit: 200_000,
    }),
  )

  expect(parsed).toEqual({
    hook_event_name: "Status",
    session_id: "ses_1",
    cwd: "/work/app/src",
    model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
    workspace: { current_dir: "/work/app/src", project_dir: "/work/app" },
    cost: { total_cost_usd: 0.25 },
    context_window: {
      total_input_tokens: 40_000,
      total_output_tokens: 10_000,
      context_window_size: 200_000,
      used_percentage: 25,
    },
  })
  expect(JSON.parse(payload({ sessionID: "s", directory: "/d", cost: 0, outputStyle: "Explanatory" }))).toMatchObject({
    model: { id: "", display_name: "" },
    workspace: { project_dir: "/d" },
    output_style: { name: "Explanatory" },
    context_window: { context_window_size: null, used_percentage: null },
  })
})

test("ansi keeps SGR styles and drops other escapes", () => {
  expect(ansi("\x1b[1;36mOpus\x1b[0m on \x1b[38;5;208mdev\x1b[39m \x1b]0;title\x07\x1b[2K\x1b[38;2;1;2;3mx")).toEqual([
    { text: "Opus", style: { bold: true, color: "#00cdcd" } },
    { text: " on ", style: {} },
    { text: "dev", style: { color: "rgb(255, 135, 0)" } },
    { text: " ", style: { color: undefined } },
    { text: "x", style: { color: "rgb(1, 2, 3)" } },
  ])
  expect(ansi("plain")).toEqual([{ text: "plain", style: {} }])
})
