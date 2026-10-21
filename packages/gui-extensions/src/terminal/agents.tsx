// cheyenne: start another agent's CLI in the session's folder from Cheyenne, in a terminal tab: a new Claude Code /
// Codex / Grok / Cursor session, or the conversation an imported session came from (packages/plugins/claude-code and
// agent-sessions import them with ids ses_<agent>_<uuid without dashes>). Continuing forks where the CLI can, so the
// source transcript stays as it was and the fork shows up as its own imported session.
// A login + interactive zsh finds the CLIs (~/.local/bin, ~/.grok/bin) that Electron's PATH lacks; the tab drops to
// a shell when the agent exits.
import { Button } from "@opencode/ui/button"
import { For, Show } from "solid-js"
import { Command, Slot, type MountedSession, type Setup } from "../sdk"
import type Terminal from "./index"
import type { TerminalModel } from "./model"

const DOCK = "terminal:main"

const AGENTS = [
  { key: "claude", name: "Claude Code", label: "Claude", cli: "claude", resume: (id: string) => `claude --resume ${id} --fork-session` },
  { key: "codex", name: "Codex", label: "Codex", cli: "codex", resume: (id: string) => `codex fork ${id}` },
  { key: "grok", name: "Grok", label: "Grok", cli: "grok", resume: (id: string) => `grok --resume ${id} --fork-session` },
  // ponytail: cursor-agent has no fork; resume appends to the chat it came from.
  { key: "cursor", name: "Cursor", label: "Cursor", cli: "cursor-agent", resume: (id: string) => `cursor-agent --resume ${id}` },
] as const

type Agent = (typeof AGENTS)[number]

/** The agent and its own session id an imported session came from. */
export const origin = (sessionId: string) => {
  const match = sessionId.match(/^ses_(claude|codex|grok|cursor)_([0-9a-f]{32})$/)
  if (!match) return
  const h = match[2]!
  return {
    agent: AGENTS.find((a) => a.key === match[1])!,
    id: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
  }
}

export function addAgents(ctx: Parameters<Setup<typeof Terminal>>[0], model: TerminalModel) {
  const start = (session: MountedSession, agent: Agent, script: string) => {
    ctx.layout.open(DOCK, session)
    model.load(session).new({ title: agent.name, command: "/bin/zsh", args: ["-ilc", `${script}; exec zsh -il`] })
  }
  const launch = (session: MountedSession, agent: Agent) => start(session, agent, agent.cli)
  const resume = (session: MountedSession) => {
    const from = origin(session.id)
    if (from) start(session, from.agent, from.agent.resume(from.id))
  }

  for (const agent of AGENTS)
    ctx.add(
      Command,
      (): Command => ({
        id: `agent.${agent.key}`,
        title: `New ${agent.name} session`,
        description: `Start ${agent.cli} in this session's folder, in a terminal tab`,
        group: "Agents",
        section: "terminal",
        enabled: !!ctx.sessions.current(),
        run() {
          const session = ctx.sessions.current()
          if (session) launch(session, agent)
        },
      }),
    )

  ctx.add(
    Command,
    (): Command => {
      const session = ctx.sessions.current()
      const from = session && origin(session.id)
      return {
        id: "agent.continue",
        title: from ? `Continue in ${from.agent.name}` : "Continue in its agent",
        description: from ? from.agent.resume(from.id) : undefined,
        group: "Agents",
        section: "terminal",
        enabled: !!from,
        run() {
          if (session) resume(session)
        },
      }
    },
  )

  ctx.add(Slot, {
    at: "session.header",
    order: 15,
    render: (input) => {
      const from = () => origin(input.session.id)
      return (
        <div style={{ display: "flex", gap: "4px", "align-items": "center" }} data-component="cheyenne-agents">
          <Show when={from()}>
            {(f) => (
              <Button size="small" variant="outline" icon="terminal" onClick={() => resume(input.session)}>
                {`Continue in ${f().agent.name}`}
              </Button>
            )}
          </Show>
          <For each={AGENTS}>
            {(agent) => (
              <Button
                size="small"
                variant="ghost-muted"
                title={`New ${agent.name} session in this folder`}
                onClick={() => launch(input.session, agent)}
              >
                {`+ ${agent.label}`}
              </Button>
            )}
          </For>
        </div>
      )
    },
  })
}
