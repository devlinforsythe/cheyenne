import { Plugin } from "@opencode/plugin"
import { Schema } from "effect"
import * as Mission from "./mission"
import { runWorker, tail } from "./workers"

export default Plugin.define({
  id: "cheyenne.workers",
  async setup(ctx) {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "run_worker",
        options: { codemode: false },
        description: [
          "Run one stage brief through an external worker (over ACP, else its CLI), logged in with the owner's own subscription.",
          "claude = Claude Code (plans, multi-file code, verification); codex = Codex (visuals / UI);",
          "cursor = Cursor agent (code review, parallel builds); grok = Grok Build (research, builds).",
          "The worker runs in mission_dir with write access there (edits outside it are denied), its messages and tool calls stream into this call,",
          "and a `brain log -a <worker>` entry records the run when it ends. Runs are capped at 30 minutes.",
        ].join(" "),
        input: Schema.Struct({
          worker: Schema.Literals(["claude", "codex", "cursor", "grok"]),
          stage_brief: Schema.String.annotate({ description: "The full prompt for the worker" }),
          mission_dir: Schema.String.annotate({ description: "Absolute path the worker runs in" }),
          business: Schema.optionalKey(Schema.String).annotate({
            description: "brain business for the log entry (default: the one mission_dir belongs to)",
          }),
          topic: Schema.optionalKey(Schema.String).annotate({ description: "brain workstream for the log entry" }),
        }),
        async execute({ worker, stage_brief, mission_dir, business, topic }, context) {
          let last = 0
          const result = await runWorker({
            worker,
            brief: stage_brief,
            dir: mission_dir,
            business,
            topic,
            signal: context.signal,
            onData: (_, output) => {
              // ponytail: progress throttled to ~2/s; the UI only needs the latest tail
              if (Date.now() - last < 500) return
              last = Date.now()
              void context.progress({ worker, output: tail(output) })
            },
          })
          const content = `${worker} ${result.status} in ${result.seconds}s\n${result.logged}\n\n${tail(result.output).trim()}`
          return {
            content,
            metadata: { worker, exit: result.code, seconds: result.seconds, output: tail(result.output), brain: result.logged },
          }
        },
      })

      // Cheyenne C3: missions. There is deliberately no approve tool: only the owner starts a stage, from the
      // Command Center's Approve button or `cheyenne-mission approve <id>` in a terminal.
      const StageInput = Schema.Struct({
        stage: Schema.String,
        workers: Schema.Array(Schema.Literals(["claude", "codex", "cursor", "grok"])),
        brief: Schema.String,
        pause: Schema.optionalKey(Schema.Boolean),
      })
      tools.add({
        name: "mission_open",
        options: { codemode: false },
        description: [
          "Open a Cheyenne mission for a build request from the owner (\"build a …\", \"make a …\"): a git worktree of",
          "the right repo on branch mission/<name> in ~/missions/<name>, a MISSION.md in it with the goal, the stage list",
          "and status, and a brain status entry. The default stages are plan (claude) → research + build (grok + cursor,",
          "in parallel) → visuals/UX (codex, against the Recode design system) → verify (claude). Every stage waits for",
          "the owner's approval in the Command Center; you cannot start stages yourself. Pick the repo the work belongs",
          "in (read ~/My Businesses/AGENTS.md if unsure) and put the business's standing rules in `rules`.",
        ].join(" "),
        input: Schema.Struct({
          goal: Schema.String.annotate({ description: "The owner's request, as the mission goal" }),
          repo: Schema.String.annotate({ description: "Absolute path of the git repo the work belongs in" }),
          business: Schema.String.annotate({ description: "brain business: recode, wolfe, bethe1, consulting, personal, muttclub, infra" }),
          name: Schema.optionalKey(Schema.String).annotate({ description: "Short kebab-case mission name (default: from the goal)" }),
          base: Schema.optionalKey(Schema.String).annotate({ description: "Branch to start from (default main)" }),
          rules: Schema.optionalKey(Schema.String).annotate({
            description: "Standing rules every worker gets: naming, merge rules, skills/corpus to use",
          }),
          stages: Schema.optionalKey(Schema.Array(StageInput)).annotate({
            description: "A custom stage template, in order (default: plan → research + build → visuals/UX → verify)",
          }),
        }),
        async execute(input) {
          const mission = await Mission.open({ ...input, stages: input.stages?.map((s) => ({ ...s, workers: [...s.workers] })) })
          return {
            content: `Mission ${mission.id} opened: ${Mission.summary(mission)}.\nThe owner approves each stage in the Command Center.\n\n${Mission.render(mission)}`,
            metadata: { id: mission.id, worktree: mission.worktree },
          }
        },
      })
      tools.add({
        name: "mission_status",
        options: { codemode: false },
        description: "List Cheyenne missions and where each stands, or show one mission's MISSION.md when id is given.",
        input: Schema.Struct({ id: Schema.optionalKey(Schema.String) }),
        async execute({ id }) {
          const content = id
            ? Mission.render(Mission.list().find((m) => m.id === id) ?? Mission.load(id))
            : Mission.list()
                .map((m) => `${m.id}: ${Mission.summary(m)} — ${m.goal} (${m.worktree})`)
                .join("\n") || "No missions."
          return { content, metadata: {} }
        },
      })
    })
  },
})
