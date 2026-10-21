import { createSignal, For, Match, onCleanup, Show, Switch, type Accessor, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { ScrollView } from "@opencode/ui/scroll-view"
import { showToast } from "@opencode/ui/toast"
import { Markdown } from "@opencode/session-ui/markdown"
import { createKeyed, useExtension, type IpcClient, type Live } from "../sdk"
import type { Rooms, State } from "./contract"

// cheyenne: the four rooms, read in one `cheyenne-rooms state` call; every button is one CLI call (main.ts).
const TABS = ["kanban", "loop", "pipeline", "mastermind"] as const

const COLUMNS = ["planner", "builder", "reviewer", "done"] as const

type Client = IpcClient<(typeof Rooms)["spec"]>

// The Command Center's look: rust arch, tunnel lamp and steel, through the theme's variables.
const heading = "font-condensed uppercase tracking-[0.12em] text-11-medium"

const rust = { color: "var(--icon-brand-base)" }

const lamp = { color: "var(--icon-warning-base)" }

const success = { color: "var(--text-success-base)" }

const danger = { color: "var(--text-danger-base)" }

// A card's, loop's or idea's status, or a judge's verdict, in the mission chips' colours.
const TONES: Record<string, JSX.CSSProperties> = {
  done: success,
  passed: success,
  approved: success,
  PASS: success,
  running: rust,
  shaping: rust,
  waiting: lamp,
  review: lamp,
  failed: danger,
  FAIL: danger,
}

const weak = "text-12-regular text-text-weak"

const block = "flex flex-col gap-2 px-5 py-3 border-b border-v2-border-border-base text-13-regular"

const bar = "flex flex-wrap items-center gap-2 px-5 py-3 border-b border-v2-border-border-base text-12-regular text-text-weak"

const field = "rounded border border-v2-border-border-base bg-transparent px-1.5 py-1 text-12-regular text-text-base"

const area = "min-h-14 w-full rounded border border-v2-border-border-base bg-transparent p-2 text-13-regular text-text-base"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const home = (path: string) => path.replace(/^\/Users\/[^/]+/, "~")

export default function RoomsPanel(props: { rooms: Accessor<Live<Client>> }) {
  const ctx = useExtension()
  const [view, setView] = createSignal<(typeof TABS)[number]>("kanban")
  const [rooms, setRooms] = createStore<{ state?: typeof State.Type; error?: string }>({})
  // The open Mastermind chat: undefined is the newest; "new" is none, so the next message starts one.
  const [chosen, setChosen] = createSignal<string>()
  const [planner, setPlanner] = createSignal("claude")
  const [busy, setBusy] = createSignal(false)

  const client = () => {
    const live = props.rooms()

    return live.status === "active" ? live.value : undefined
  }

  // The rooms read again 3 s after the last read lands, and at once after an action. Only the newest read lands, so a
  // slow one never overwrites a newer one; reconcile keeps each card, loop, idea and message by id (or by place), so an
  // open <details>, a picked option or a half-typed field survives the refresh.
  let latest = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    const value = client()
    const read = ++latest
    const chat = chosen()
    clearTimeout(timer)
    if (!value) return
    void value
      .read(chat ? { chat } : {})
      .then(
        (state) => {
          if (read !== latest) return
          setRooms("state", reconcile(state, { key: "id" }))
          setRooms("error", undefined)
        },
        (error: unknown) => read === latest && setRooms("error", message(error)),
      )
      .finally(() => {
        if (read === latest) timer = setTimeout(refresh, 3000)
      })
  }
  createKeyed(props.rooms, () => {
    refresh()
    onCleanup(() => {
      latest++
      clearTimeout(timer)
    })
  })

  // One action at a time; a refusal toasts the CLI's own message, and the rooms read again either way.
  const act = (run: (client: Client) => Promise<unknown>) => {
    const value = client()
    if (!value || busy()) return
    setBusy(true)
    void run(value)
      .catch((error: unknown) => showToast({ title: ctx.t("error.action", { message: message(error) }) }))
      .finally(() => {
        setBusy(false)
        refresh()
      })
  }

  // Native forms: `required` checks the fields, FormData reads them, and the typed text clears once the CLI takes it.
  const submit =
    (run: (client: Client, input: Record<string, string>, data: FormData) => Promise<unknown>) =>
    (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
      event.preventDefault()
      const target = event.currentTarget
      const data = new FormData(target)
      act(async (value) => {
        await run(value, Object.fromEntries(data) as Record<string, string>, data)
        for (const box of target.querySelectorAll("textarea")) box.value = ""
      })
    }

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="rooms-panel">
      <div class="flex shrink-0 items-center gap-3 border-b border-v2-border-border-base px-5 py-3">
        <span class={`${heading} text-14-medium`} style={rust}>
          {ctx.t("title")}
        </span>
      </div>

      <div class="flex shrink-0 flex-wrap gap-1 border-b border-v2-border-border-base px-4 py-2" role="tablist">
        <For each={TABS}>
          {(id) => (
            <button
              type="button"
              role="tab"
              aria-selected={view() === id}
              class="rounded px-2 py-0.5 text-12-medium"
              classList={{ "text-text-weak": view() !== id, "bg-v2-background-bg-layer-02 text-text-base": view() === id }}
              onClick={() => setView(id)}
            >
              {ctx.t(`tab.${id}`)}
            </button>
          )}
        </For>
      </div>

      <Show
        when={props.rooms().status === "active"}
        fallback={<div class="p-5 text-13-regular text-text-weak">{ctx.t("unavailable")}</div>}
      >
        <Show when={rooms.error}>
          {(error) => (
            <div class="px-5 py-3 text-13-regular text-text-danger-base">{ctx.t("error.load", { message: error() })}</div>
          )}
        </Show>
        <ScrollView class="min-h-0 flex-1">
          <Show when={rooms.state} fallback={<div class="p-5 text-13-regular text-text-weak">{ctx.t("loading")}</div>}>
            {(state) => (
              <Switch>
                <Match when={view() === "kanban"}>
                  <div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 px-4 py-3">
                    <For each={COLUMNS}>
                      {(column) => {
                        const cards = () => state().cards.filter((card) => card.column === column)

                        return (
                          <section class="flex min-w-0 flex-col gap-2">
                            <h2 class={heading} style={lamp}>
                              {ctx.t(`column.${column}`)}
                              <span class="ml-2 text-text-weak">{cards().length}</span>
                            </h2>
                            <For each={cards()} fallback={<span class={weak}>{ctx.t("empty")}</span>}>
                              {(card) => (
                                <div
                                  class="flex flex-col gap-1 rounded border border-v2-border-border-base p-2 text-13-regular"
                                  title={card.summary}
                                >
                                  <span class="text-text-base">{card.goal}</span>
                                  <span class={weak}>
                                    {[card.business, card.stage].filter(Boolean).join(" · ")} ·{" "}
                                    <span style={TONES[card.status]}>{card.status}</span>
                                  </span>
                                  <span class={weak}>{card.workers.join(" + ")}</span>
                                  <Show when={card.status === "waiting" || card.status === "failed"}>
                                    <div>
                                      <Button
                                        size="small"
                                        disabled={busy()}
                                        onClick={() => act((value) => value.approve({ id: card.id }))}
                                      >
                                        {ctx.t(card.status === "failed" ? "retry" : "approve")}
                                      </Button>
                                    </div>
                                  </Show>
                                </div>
                              )}
                            </For>
                          </section>
                        )
                      }}
                    </For>
                  </div>
                  <form
                    class={block}
                    onSubmit={submit((value, input) =>
                      value.newCard({ goal: input.goal, business: input.business, repo: input.repo || undefined }),
                    )}
                  >
                    <h2 class={heading} style={lamp}>
                      {ctx.t("kanban.new")}
                    </h2>
                    <textarea name="goal" required class={area} placeholder={ctx.t("kanban.goal")} />
                    <div class="flex flex-wrap gap-2">
                      <select name="business" required class={field} aria-label={ctx.t("business")}>
                        <option value="">{ctx.t("business")}</option>
                        <For each={state().businesses}>{(name) => <option value={name}>{name}</option>}</For>
                      </select>
                      <input name="repo" class={`${field} min-w-0 flex-1`} placeholder={ctx.t("repo")} />
                    </div>
                    <div>
                      <Button size="small" type="submit" disabled={busy()}>
                        {ctx.t("kanban.add")}
                      </Button>
                    </div>
                  </form>
                </Match>

                <Match when={view() === "loop"}>
                  <form
                    class={block}
                    onSubmit={submit((value, input) =>
                      value.loopStart({
                        mission: input.mission,
                        done: input.done,
                        builder: input.builder,
                        judge: input.judge,
                        rounds: Number(input.rounds),
                      }),
                    )}
                  >
                    <h2 class={heading} style={lamp}>
                      {ctx.t("loop.new")}
                    </h2>
                    <select name="mission" required class={field} aria-label={ctx.t("loop.mission")}>
                      <option value="">{ctx.t("loop.mission")}</option>
                      <For each={state().cards}>
                        {(card) => (
                          <option value={card.id}>
                            {card.id} — {card.goal}
                          </option>
                        )}
                      </For>
                    </select>
                    <textarea name="done" required class={area} placeholder={ctx.t("loop.done")} />
                    <div class={`flex flex-wrap items-center gap-3 ${weak}`}>
                      <label class="flex items-center gap-1.5">
                        {ctx.t("loop.builder")}
                        <select name="builder" class={field}>
                          <For each={state().workers}>
                            {(name) => (
                              <option value={name} selected={name === "claude"}>
                                {name}
                              </option>
                            )}
                          </For>
                        </select>
                      </label>
                      <label class="flex items-center gap-1.5">
                        {ctx.t("loop.judge")}
                        <select name="judge" class={field}>
                          <For each={state().agents}>
                            {(name) => (
                              <option value={name} selected={name === "codex"}>
                                {name}
                              </option>
                            )}
                          </For>
                        </select>
                      </label>
                      <label class="flex items-center gap-1.5">
                        {ctx.t("loop.rounds")}
                        <input name="rounds" type="number" min="1" max="8" value="4" required class={`${field} w-14`} />
                      </label>
                    </div>
                    <div>
                      <Button size="small" type="submit" disabled={busy()}>
                        {ctx.t("loop.start")}
                      </Button>
                    </div>
                  </form>
                  <For each={state().loops} fallback={<div class={`${block} text-text-weak`}>{ctx.t("loop.none")}</div>}>
                    {(loop) => (
                      <div class={block}>
                        <span class="text-text-base">
                          {loop.mission} ·{" "}
                          <span style={TONES[loop.status]}>
                            {ctx.t("loop.status", { status: loop.status, round: loop.history.length, rounds: loop.rounds })}
                          </span>
                        </span>
                        <span class={weak}>{ctx.t("loop.who", { builder: loop.builder, judge: loop.judge })}</span>
                        <span class="whitespace-pre-wrap text-text-base">{loop.done}</span>
                        <Show when={loop.note}>
                          {(note) => (
                            <span class="whitespace-pre-wrap text-12-regular" style={TONES[loop.status]}>
                              {note()}
                            </span>
                          )}
                        </Show>
                        <For each={loop.history}>
                          {(round) => (
                            <details>
                              <summary class={`cursor-pointer ${weak}`}>
                                {ctx.t("loop.round", { round: round.round, builder: round.builder, seconds: round.seconds })}{" "}
                                · <span style={TONES[round.verdict]}>{round.verdict}</span>
                              </summary>
                              <Markdown text={round.feedback} class="mt-1 text-12-regular" />
                            </details>
                          )}
                        </For>
                        <Show when={loop.status === "running"}>
                          <div>
                            <Button
                              size="small"
                              variant="ghost"
                              disabled={busy()}
                              onClick={() => act((value) => value.loopStop({ id: loop.id }))}
                            >
                              {ctx.t("loop.stop")}
                            </Button>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </Match>

                <Match when={view() === "pipeline"}>
                  <label class={bar}>
                    {ctx.t("pipeline.planner")}
                    <select class={field} onChange={(event) => setPlanner(event.currentTarget.value)}>
                      <For each={state().agents}>
                        {(name) => (
                          <option value={name} selected={name === planner()}>
                            {name}
                          </option>
                        )}
                      </For>
                    </select>
                  </label>
                  <For each={state().ideas} fallback={<div class={`${block} text-text-weak`}>{ctx.t("empty")}</div>}>
                    {(idea) => (
                      <div class={block}>
                        <span class="text-text-base">{idea.idea}</span>
                        <span class={weak}>
                          {[idea.id, idea.business, idea.project].filter(Boolean).join(" · ")} ·{" "}
                          <span style={TONES[idea.stage]}>{idea.stage}</span>
                        </span>
                        <Show when={idea.error}>{(error) => <span class="text-12-regular" style={danger}>{error()}</span>}</Show>
                        <Show when={idea.stage === "review" ? idea.plan : undefined}>
                          {(plan) => (
                            <form
                              class="flex flex-col gap-2"
                              onSubmit={submit((value, input) => value.approveIdea({ id: idea.id, repo: input.repo || undefined }))}
                            >
                              <span class="text-text-base">
                                {plan().route} · {plan().business} · {plan().title}
                              </span>
                              <span class={weak}>{plan().why}</span>
                              <ol class="list-decimal pl-5">
                                <For each={plan().stages}>
                                  {(stage) => (
                                    <li class="whitespace-pre-wrap">
                                      {stage.stage} · {stage.workers.join(" + ")} — {stage.brief}
                                    </li>
                                  )}
                                </For>
                              </ol>
                              <div class="flex flex-wrap items-center gap-2">
                                <Show when={plan().stages.length} fallback={<span class={weak}>{ctx.t("pipeline.nobuild")}</span>}>
                                  <input name="repo" class={`${field} min-w-0 flex-1`} placeholder={home(plan().repo)} />
                                  <Button size="small" type="submit" disabled={busy()}>
                                    {ctx.t("pipeline.approve")}
                                  </Button>
                                </Show>
                                <Button
                                  size="small"
                                  variant="ghost"
                                  type="button"
                                  disabled={busy()}
                                  onClick={() => act((value) => value.rejectIdea({ id: idea.id }))}
                                >
                                  {ctx.t("pipeline.reject")}
                                </Button>
                              </div>
                            </form>
                          )}
                        </Show>
                        <Show when={idea.mission}>
                          {(mission) => <span class={weak}>{ctx.t("pipeline.mission", { mission: mission() })}</span>}
                        </Show>
                        <Show when={idea.stage !== "shaping" && idea.stage !== "approved"}>
                          <div>
                            <Button
                              size="small"
                              variant={idea.stage === "new" ? undefined : "ghost"}
                              disabled={busy()}
                              onClick={() => act((value) => value.shape({ id: idea.id, planner: planner() }))}
                            >
                              {ctx.t(idea.stage === "new" ? "pipeline.shape" : "pipeline.reshape")}
                            </Button>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </Match>

                <Match when={view() === "mastermind"}>
                  <label class={bar}>
                    {ctx.t("chat.pick")}
                    <select
                      class={`${field} min-w-0 flex-1`}
                      onChange={(event) => {
                        setChosen(event.currentTarget.value)
                        refresh()
                      }}
                    >
                      <For each={state().chats}>
                        {(item) => (
                          <option value={item.id} selected={item.id === state().chat?.id}>
                            {item.title} ({item.count})
                          </option>
                        )}
                      </For>
                      <option value="new" selected={!state().chat}>
                        {ctx.t("chat.new")}
                      </option>
                    </select>
                  </label>
                  <div class="flex flex-col gap-3 px-5 py-3 text-13-regular">
                    <For each={state().chat?.messages} fallback={<span class="text-text-weak">{ctx.t("chat.none")}</span>}>
                      {(line) => (
                        <Show
                          when={line.from !== "owner"}
                          fallback={
                            <div class="ml-8 flex flex-col items-end gap-1">
                              <span class={heading} style={rust}>
                                {ctx.t("chat.you")}
                              </span>
                              <span class="whitespace-pre-wrap rounded bg-v2-background-bg-layer-02 px-2 py-1 text-text-base">
                                {line.text}
                              </span>
                            </div>
                          }
                        >
                          <div class="mr-8 flex flex-col gap-1">
                            <span class={heading} style={lamp}>
                              {line.from}
                            </span>
                            <Show when={!line.error} fallback={<span style={danger}>{line.text}</span>}>
                              <Markdown text={line.text} class="text-13-regular" />
                            </Show>
                          </div>
                        </Show>
                      )}
                    </For>
                    <Show when={state().chat?.typing}>
                      {(agent) => (
                        <span class="text-12-regular" style={rust}>
                          {ctx.t("chat.typing", { agent: agent() })}
                        </span>
                      )}
                    </Show>
                    <Show when={state().chat?.pending.filter((agent) => agent !== state().chat?.typing).join(", ")}>
                      {(agents) => <span class={weak}>{ctx.t("chat.pending", { agents: agents() })}</span>}
                    </Show>
                  </div>
                  <form
                    class={block}
                    onSubmit={submit(async (value, input, data) => {
                      const present = data.getAll("present").map(String)
                      const id = (chosen() !== "new" && state().chat?.id) || (await value.newChat({ present })).id
                      setChosen(id)
                      await value.say({ id, text: input.text, present })
                    })}
                  >
                    <div class={`flex flex-wrap items-center gap-3 ${weak}`}>
                      {ctx.t("chat.roster")}
                      <For each={state().agents}>
                        {(agent) => (
                          <label class="flex items-center gap-1">
                            <input
                              type="checkbox"
                              name="present"
                              value={agent}
                              checked={(state().chat?.present ?? state().agents).includes(agent)}
                              style={{ "accent-color": "var(--surface-brand-base)" }}
                            />
                            {agent}
                          </label>
                        )}
                      </For>
                    </div>
                    <textarea
                      name="text"
                      required
                      class={area}
                      placeholder={ctx.t("chat.say", { tags: state().agents.map((agent) => `@${agent}`).join(", ") })}
                    />
                    <div>
                      <Button size="small" type="submit" disabled={busy()}>
                        {ctx.t("chat.send")}
                      </Button>
                    </div>
                  </form>
                </Match>
              </Switch>
            )}
          </Show>
        </ScrollView>
      </Show>
    </div>
  )
}
