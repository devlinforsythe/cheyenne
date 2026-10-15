import { createSignal, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ScrollView } from "@opencode/ui/scroll-view"
import { showToast } from "@opencode/ui/toast"
import { Markdown } from "@opencode/session-ui/markdown"
import { createLatest, useExtension, type IpcClient, type Live } from "../sdk"
import type { CommandCenter } from "./contract"

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

  // The status each to-do had before the owner ticked it here, so unticking puts it back.
  const [ticked, setTicked] = createStore<Record<string, string | undefined>>({})

  const client = () => {
    const live = props.center()

    return live.status === "active" ? { client: live.value, tick: tick() } : undefined
  }

  const airtable = createLatest(client, (value, signal) => value.client.airtable({ signal }))
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

      <Show when={props.center().status === "active"} fallback={<div class="p-5 text-13-regular text-text-weak">{ctx.t("unavailable")}</div>}>
        <ScrollView class="min-h-0 flex-1">
          <Show when={airtable.error}>
            <div class="px-5 py-3 text-13-regular text-text-danger-base">
              {ctx.t("error.airtable", { message: airtable.error instanceof Error ? airtable.error.message : String(airtable.error) })}
            </div>
          </Show>

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
    </div>
  )
}
