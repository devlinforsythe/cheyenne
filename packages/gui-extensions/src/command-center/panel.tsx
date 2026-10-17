import { createSignal, For, onCleanup, Show, lazy, Suspense, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ScrollView } from "@opencode/ui/scroll-view"
import { showToast } from "@opencode/ui/toast"
import { Markdown } from "@opencode/session-ui/markdown"
import { createLatest, useExtension, type IpcClient, type Live } from "../sdk"
import type { CommandCenter } from "./contract"

// cheyenne 6.0a: Today is the original panel; the rest are the base's tables (tabs.ts).
const TABS = ["today", "tasks", "projects", "decisions", "events", "travel", "accounts", "ask", "shopify", "shipstation", "reverb"] as const // cheyenne 6.0c: reverb

const TableView = lazy(() => import("./table"))

type Client = IpcClient<(typeof CommandCenter)["spec"]>

// Rust arch, tunnel lamp and steel from the Cheyenne theme, through the theme's variables.
const heading = "font-condensed uppercase tracking-[0.12em] text-11-medium"

const rust = { color: "var(--icon-brand-base)" }

const lamp = { color: "var(--icon-warning-base)" }

function Section(props: { title: string; count?: number; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-2 px-5 py-4 border-b border-v2-border-border-base">
      <h2 class={heading} style={lamp}>
        {props.title}
        <Show when={props.count !== undefined}>
          <span class="ml-2 text-text-weak">{props.count}</span>
        </Show>
      </h2>
      {props.children}
    </section>
  )
}

export default function CommandCenterPanel(props: { center: Accessor<Live<Client>> }) {
  const ctx = useExtension()
  const [tick, setTick] = createSignal(0)
  const [view, setView] = createSignal<(typeof TABS)[number]>("today")

  // The status each to-do had before the owner ticked it here, so unticking puts it back.
  const [ticked, setTicked] = createStore<Record<string, string | undefined>>({})

  const client = () => {
    const live = props.center()

    return live.status === "active" ? { client: live.value, tick: tick() } : undefined
  }

  const airtable = createLatest(client, (value, signal) => value.client.airtable({ signal }))

  // cheyenne C3: missions refresh every 5 s while the panel is open, so a running stage shows when it ends.
  const [beat, setBeat] = createSignal(0)
  const timer = setInterval(() => setBeat(beat() + 1), 5000)
  onCleanup(() => clearInterval(timer))
  const missions = createLatest(
    () => {
      const value = client()
      return value && { ...value, beat: beat() }
    },
    (value, signal) => value.client.missions({ signal }),
  )
  const [approving, setApproving] = createSignal<string>()
  const approve = (id: string) => {
    const live = props.center()
    if (live.status !== "active") return
    setApproving(id)
    void live.value
      .approve({ id })
      .catch((error: unknown) =>
        showToast({ title: ctx.t("error.approve", { message: error instanceof Error ? error.message : String(error) }) }),
      )
      .finally(() => {
        setApproving(undefined)
        setBeat(beat() + 1)
      })
  }
  const brief = createLatest(client, (value, signal) => value.client.brief({ signal }))

  // Ticks optimistically, and puts the tick back the way it was if Airtable refuses.
  const write = (id: string, status: string, before: string | undefined, after: string | undefined) => {
    const live = props.center()

    if (live.status !== "active") return void showToast({ title: ctx.t("error.update") })
    setTicked(id, after)
    void live.value.setStatus({ id, status }).catch(() => {
      setTicked(id, before)
      showToast({ title: ctx.t("error.update") })
    })
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="command-center-panel">
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-v2-border-border-base px-5 py-3">
        <div class="flex min-w-0 flex-col">
          <span class={`${heading} text-14-medium`} style={rust}>
            {ctx.t("title")}
          </span>
          <span class="text-12-regular text-text-weak">{today}</span>
        </div>
        <IconButton
          size="small"
          variant="ghost-muted"
          icon={<Icon name="refresh" />}
          aria-label={ctx.t("refresh")}
          disabled={airtable.loading || brief.loading}
          onClick={() => setTick(tick() + 1)}
        />
      </div>

      <div class="flex shrink-0 flex-wrap gap-1 border-b border-v2-border-border-base px-4 py-2" role="tablist">
        <For each={TABS}>
          {(id) => (
            <button
              type="button"
              role="tab"
              aria-selected={view() === id}
              class="rounded px-2 py-0.5 text-12-medium"
              classList={{ "text-text-weak": view() !== id, "bg-v2-background-bg-strong text-text-base": view() === id }}
              onClick={() => setView(id)}
            >
              {ctx.t(`tab.${id}`)}
            </button>
          )}
        </For>
      </div>

      <Show when={view() !== "today" && props.center().status === "active"}>
        <ScrollView class="min-h-0 flex-1">
          <Suspense>
            <TableView center={props.center} tab={view()} tick={tick()} />
          </Suspense>
        </ScrollView>
      </Show>

      <Show when={view() === "today"}>
      <Show when={props.center().status === "active"} fallback={<div class="p-5 text-13-regular text-text-weak">{ctx.t("unavailable")}</div>}>
        <ScrollView class="min-h-0 flex-1">
          <Show when={airtable.error}>
            <div class="px-5 py-3 text-13-regular text-text-danger-base">
              {ctx.t("error.airtable", { message: airtable.error instanceof Error ? airtable.error.message : String(airtable.error) })}
            </div>
          </Show>

          <Section title={ctx.t("missions")} count={missions.latest?.length}>
            <Show when={missions.error}>
              <div class="text-13-regular text-text-danger-base">
                {ctx.t("error.missions", { message: missions.error instanceof Error ? missions.error.message : String(missions.error) })}
              </div>
            </Show>
            <For each={missions.latest} fallback={<span class="text-13-regular text-text-weak">{ctx.t("empty")}</span>}>
              {(mission) => {
                const stage = () => mission.stages.find((item) => item.status !== "done")

                return (
                  <div class="flex flex-col gap-1.5 text-13-regular" data-slot="mission">
                    <span class="text-text-base">{mission.goal}</span>
                    <span class="text-12-regular text-text-weak">
                      {mission.business} · {mission.branch} · {mission.worktree.replace(/^\/Users\/[^/]+/, "~")}
                    </span>
                    <div class="flex flex-wrap gap-1.5">
                      <For each={mission.stages}>
                        {(item) => (
                          <span
                            class="rounded px-1.5 py-0.5 text-11-medium"
                            classList={{
                              "bg-v2-background-bg-strong text-text-weak": item.status === "pending",
                              "text-text-base": item.status !== "pending",
                            }}
                            style={
                              item.status === "done"
                                ? { background: "var(--surface-success-weak, transparent)", color: "var(--text-success-base)" }
                                : item.status === "waiting"
                                  ? { "box-shadow": "inset 0 0 0 1px var(--icon-warning-base)", ...lamp }
                                  : item.status === "running"
                                    ? { background: "var(--surface-brand-base)", color: "white" }
                                    : item.status === "failed"
                                      ? { color: "var(--text-danger-base)" }
                                      : {}
                            }
                            title={`${item.workers.join(" + ")}: ${item.status}`}
                          >
                            {item.stage} · {item.workers.join("+")}
                          </span>
                        )}
                      </For>
                    </div>
                    <Show when={stage()?.status === "waiting" || stage()?.status === "failed" ? stage() : undefined}>
                      {(next) => (
                        <div>
                          <Button size="small" disabled={approving() === mission.id} onClick={() => approve(mission.id)}>
                            {ctx.t(next().status === "failed" ? "retry" : "approve", { stage: next().stage })}
                          </Button>
                        </div>
                      )}
                    </Show>
                  </div>
                )
              }}
            </For>
          </Section>

          <Section title={ctx.t("events")} count={airtable.latest?.events.length}>
            <For each={airtable.latest?.events} fallback={<span class="text-13-regular text-text-weak">{ctx.t("empty")}</span>}>
              {(event) => (
                <div class="flex gap-3 text-13-regular">
                  <span class="shrink-0 whitespace-nowrap tabular-nums text-text-weak">
                    {event.start}
                  </span>
                  <span class="min-w-0 flex-1 text-text-base">
                    {event.title}
                    <span class="text-text-weak">
                      {[event.calendar, event.status].flatMap((part) => (part ? [` · ${part}`] : [])).join("")}
                    </span>
                  </span>
                </div>
              )}
            </For>
          </Section>

          <Section title={ctx.t("requests")} count={airtable.latest?.requests.length}>
            <For each={airtable.latest?.requests} fallback={<span class="text-13-regular text-text-weak">{ctx.t("empty")}</span>}>
              {(request) => (
                <div class="text-13-regular text-text-base">
                  <span class="line-clamp-3">{request.title}</span>
                  <Show when={request.from}>
                    <span class="text-12-regular text-text-weak">{request.from}</span>
                  </Show>
                </div>
              )}
            </For>
          </Section>

          <Section title={ctx.t("todos")} count={airtable.latest?.todos.filter((todo) => ticked[todo.id] === undefined).length}>
            <For each={airtable.latest?.todos} fallback={<span class="text-13-regular text-text-weak">{ctx.t("empty")}</span>}>
              {(todo) => {
                const done = () => ticked[todo.id] !== undefined

                return (
                  <label class="flex cursor-pointer items-start gap-2.5 text-13-regular">
                    <input
                      type="checkbox"
                      class="mt-0.5 shrink-0"
                      style={{ "accent-color": "var(--surface-brand-base)" }}
                      checked={done()}
                      onChange={(event) =>
                        event.currentTarget.checked
                          ? write(todo.id, "Done", undefined, todo.status)
                          : write(todo.id, ticked[todo.id] ?? todo.status, ticked[todo.id], undefined)
                      }
                    />
                    <span class="min-w-0 flex-1" classList={{ "line-through text-text-weak": done(), "text-text-base": !done() }}>
                      {todo.title}
                      <span class="block text-12-regular text-text-weak">
                        {[todo.priority, todo.category, todo.status === "To do" ? undefined : todo.status, todo.target]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                )
              }}
            </For>
          </Section>

          <Section title={ctx.t("brief")}>
            <Show when={brief.error}>
              <div class="text-13-regular text-text-danger-base">{ctx.t("error.brief", { message: brief.error instanceof Error ? brief.error.message : String(brief.error) })}</div>
            </Show>
            <Show when={brief.latest}>{(text) => <Markdown text={text()} class="text-13-regular" />}</Show>
          </Section>
        </ScrollView>
      </Show>
      </Show>
    </div>
  )
}
