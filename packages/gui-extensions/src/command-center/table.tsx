import { createSignal, For, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { showToast } from "@opencode/ui/toast"
import { createLatest, useExtension, type IpcClient, type Live } from "../sdk"
import type { CommandCenter } from "./contract"
import { tab as find, type Tab } from "./tabs"

type Client = IpcClient<(typeof CommandCenter)["spec"]>

type Fields = Record<string, unknown>

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Airtable values as one line of text; link ids, attachments and formula errors show nothing.
const show = (value: unknown): string | undefined => {
  if (typeof value === "string") return value || undefined
  if (typeof value === "number") return value.toLocaleString()
  if (value === true) return "✓"
  if (Array.isArray(value)) {
    const parts = value.filter((item): item is string => typeof item === "string" && !/^rec[A-Za-z0-9]{14}$/.test(item))
    return parts.length ? parts.join(", ") : undefined
  }
  return undefined
}

const Value = (props: { value: string }) => (
  <Show when={/^https?:\/\//.test(props.value)} fallback={props.value}>
    <a href={props.value} target="_blank" rel="noreferrer" class="underline">
      link
    </a>
  </Show>
)

export default function TableView(props: { center: Accessor<Live<Client>>; tab: string; ids?: string[]; tick?: number }) {
  const ctx = useExtension()
  const config = () => find(props.tab) as Tab
  const [tick, setTick] = createSignal(0)
  const [open, setOpen] = createSignal<string>()
  // Local edits over what Airtable sent, so a change shows at once and goes back if Airtable refuses.
  const [local, setLocal] = createStore<Record<string, Fields>>({})
  const [draft, setDraft] = createStore<Record<string, string | undefined>>({})
  const [text, setText] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const client = () => {
    const live = props.center()
    return live.status === "active" ? live.value : undefined
  }

  const rows = createLatest(
    () => {
      const value = client()
      return value && { client: value, tab: props.tab, ids: props.ids, tick: tick() + (props.tick ?? 0) }
    },
    (value, signal) => value.client.rows({ tab: value.tab, ids: value.ids }, { signal }),
  )

  const field = (row: { id: string; fields: Fields }, name: string) => (local[row.id] ?? {})[name] ?? row.fields[name]

  const update = (id: string, fields: Record<string, string | null>, before: Fields) => {
    const value = client()
    if (!value) return
    setLocal(id, { ...(local[id] ?? {}), ...fields })
    void value.update({ tab: props.tab, id, fields }).catch((error: unknown) => {
      setLocal(id, { ...(local[id] ?? {}), ...before })
      showToast({ title: ctx.t("error.save", { message: message(error) }) })
    })
  }

  const create = () => {
    const value = client()
    const body = text().trim()
    if (!value || !body) return
    setBusy(true)
    void value
      .create({ tab: props.tab, text: body })
      .then(() => {
        setText("")
        setTick(tick() + 1)
      })
      .catch((error: unknown) => showToast({ title: ctx.t("error.save", { message: message(error) }) }))
      .finally(() => setBusy(false))
  }

  return (
    <div class="flex flex-col" data-slot="command-center-table">
      <Show when={config().create && !props.ids}>
        <form
          class="flex flex-col gap-2 px-5 py-3 border-b border-v2-border-border-base"
          onSubmit={(event) => {
            event.preventDefault()
            create()
          }}
        >
          <textarea
            class="min-h-14 w-full rounded border border-v2-border-border-base bg-transparent p-2 text-13-regular text-text-base"
            placeholder={ctx.t(`new.${props.tab}`)}
            value={text()}
            onInput={(event) => setText(event.currentTarget.value)}
          />
          <div>
            <Button size="small" type="submit" disabled={busy() || !text().trim()}>
              {ctx.t("add")}
            </Button>
          </div>
        </form>
      </Show>

      <Show when={rows.error}>
        <div class="px-5 py-3 text-13-regular text-text-danger-base">{ctx.t("error.airtable", { message: message(rows.error) })}</div>
      </Show>

      <For each={rows.latest} fallback={<span class="px-5 py-3 text-13-regular text-text-weak">{ctx.t(rows.loading ? "loading" : "empty")}</span>}>
        {(row) => {
          const meta = () => (config().meta ?? []).flatMap((name) => {
            const value = show(field(row, name))
            return value ? [value] : []
          })
          const status = () => config().status
          const linked = () => {
            const link = config().linked
            const ids = link && row.fields[link.field]
            return link && Array.isArray(ids) && ids.length ? { tab: link.tab, ids: ids.filter((id): id is string => typeof id === "string") } : undefined
          }

          return (
            <div class="flex flex-col gap-1.5 px-5 py-3 border-b border-v2-border-border-base text-13-regular" data-slot="row">
              <div class="flex items-start gap-2">
                <button
                  type="button"
                  class="min-w-0 flex-1 text-left text-text-base"
                  aria-expanded={open() === row.id}
                  onClick={() => setOpen(open() === row.id ? undefined : row.id)}
                >
                  <span class="line-clamp-3 whitespace-pre-wrap">{show(row.fields[config().title]) ?? ctx.t("untitled")}</span>
                </button>
                <Show when={status()}>
                  {(select) => (
                    <select
                      class="shrink-0 rounded border border-v2-border-border-base bg-transparent px-1 text-12-regular text-text-base"
                      aria-label={select().field}
                      value={show(field(row, select().field)) ?? ""}
                      onChange={(event) =>
                        update(row.id, { [select().field]: event.currentTarget.value }, { [select().field]: field(row, select().field) })
                      }
                    >
                      <option value="" disabled>
                        —
                      </option>
                      <For each={select().choices}>{(choice) => <option value={choice}>{choice}</option>}</For>
                    </select>
                  )}
                </Show>
              </div>
              <Show when={meta().length}>
                <span class="text-12-regular text-text-weak">
                  <For each={meta()}>
                    {(value, index) => (
                      <>
                        {index() ? " · " : ""}
                        <Value value={value} />
                      </>
                    )}
                  </For>
                </span>
              </Show>

              <Show when={open() === row.id}>
                <div class="flex flex-col gap-3 pt-1">
                  <For each={(config().body ?? []).filter((name) => !config().edit?.includes(name))}>
                    {(name) => (
                      <Show when={show(field(row, name))}>
                        {(value) => (
                          <div class="flex flex-col gap-0.5">
                            <span class="text-11-medium uppercase text-text-weak">{name}</span>
                            <span class="whitespace-pre-wrap text-text-base">{value()}</span>
                          </div>
                        )}
                      </Show>
                    )}
                  </For>
                  <For each={config().edit}>
                    {(name) => {
                      const key = `${row.id}:${name}`
                      const current = () => show(field(row, name)) ?? ""
                      return (
                        <label class="flex flex-col gap-1">
                          <span class="text-11-medium uppercase text-text-weak">{name}</span>
                          <textarea
                            class="min-h-16 w-full rounded border border-v2-border-border-base bg-transparent p-2 text-13-regular text-text-base"
                            value={draft[key] ?? current()}
                            onInput={(event) => setDraft(key, event.currentTarget.value)}
                          />
                          <Show when={draft[key] !== undefined && draft[key] !== current()}>
                            <div>
                              <Button
                                size="small"
                                onClick={() => {
                                  update(row.id, { [name]: draft[key]?.trim() ? draft[key]! : null }, { [name]: field(row, name) })
                                  setDraft(key, undefined)
                                }}
                              >
                                {ctx.t("save")}
                              </Button>
                            </div>
                          </Show>
                        </label>
                      )
                    }}
                  </For>
                  <Show when={linked()}>
                    {(link) => (
                      <div class="-mx-5 border-t border-v2-border-border-base">
                        <TableView center={props.center} tab={link().tab} ids={link().ids} />
                      </div>
                    )}
                  </Show>
                </div>
              </Show>
            </div>
          )
        }}
      </For>
    </div>
  )
}
