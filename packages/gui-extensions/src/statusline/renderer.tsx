import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import { createKeyed, createLatest, Slot, type MountedSession, type Setup } from "../sdk"
import type definition from "./index"
import { ansi, payload } from "./line"

const setup: Setup<typeof definition> = (ctx) => {
  const statusline = ctx.uses.statusline

  const Bar = (props: { session: MountedSession }) => {
    const data = () => props.session.server.data
    const messages = createMemo(() => (props.session.id ? data().session.message.list(props.session.id) : []))
    const info = createMemo(() => (props.session.id ? data().session.get(props.session.id) : undefined))

    // Keyed by the payload text, so a re-render with the same session data runs nothing.
    const input = createMemo(
      () => {
        const session = props.session
        const message = lastAssistantWithUsage(messages(), info()?.revert?.messageID)
        const ref = message?.model ?? info()?.model
        const where = session.directory ? { directory: session.directory } : undefined

        // The context extension's header loads the catalogs; until it has, the model goes without a name or limit.
        const model = ref
          ? data()
              .location.model.list(where)
              ?.findLast((item) => item.providerID === ref.providerID && item.id === ref.id)
          : undefined

        return {
          directory: session.directory,
          payload: payload({
            sessionID: session.id ?? "",
            directory: session.directory,
            project: session.listedProject?.worktree,
            model: ref ? { id: ref.id, name: model?.name } : undefined,
            cost: session.id ? data().session.cost(session.id) : 0,
            tokens: message
              ? {
                  input: message.tokens.input + message.tokens.cache.read + message.tokens.cache.write,
                  output: message.tokens.output + message.tokens.reasoning,
                }
              : undefined,
            limit: model?.limit.context,
          }),
        }
      },
      undefined,
      { equals: (a, b) => a.directory === b.directory && a.payload === b.payload },
    )

    // At most one run per 300 ms, the last change always included: a pending timer reads the newest input.
    const [due, setDue] = createSignal<ReturnType<typeof input>>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0

    createKeyed(input, () => {
      if (timer) return

      timer = setTimeout(
        () => {
          timer = undefined
          last = Date.now()
          setDue(input())
        },
        Math.max(0, last + 300 - Date.now()),
      )
    })
    onCleanup(() => clearTimeout(timer))

    const run = createMemo(() => {
      const live = statusline()
      const next = due()

      return live.status === "active" && next?.directory ? { client: live.value, input: next } : undefined
    })

    // Only the newest run lands; a failure leaves the bar empty.
    const latest = createLatest(run, (current) => current.client.run(current.input))
    const result = () => (latest.error || !run() ? undefined : latest.latest)

    return (
      <Show when={result()?.line}>
        <div
          role="status"
          aria-label={ctx.t("label")}
          class="w-full overflow-hidden whitespace-pre text-ellipsis font-mono text-11-regular text-v2-text-text-muted pt-1.5"
          style={{ "padding-inline": `${result()?.padding ?? 0}ch` }}
        >
          <For each={ansi(result()?.line ?? "")}>
            {(segment) => (
              <span
                style={{
                  color: segment.style.color,
                  background: segment.style.background,
                  "font-weight": segment.style.bold ? "bold" : undefined,
                  opacity: segment.style.dim ? 0.6 : undefined,
                  "font-style": segment.style.italic ? "italic" : undefined,
                  "text-decoration": segment.style.underline ? "underline" : undefined,
                }}
              >
                {segment.text}
              </span>
            )}
          </For>
        </div>
      </Show>
    )
  }

  ctx.add(Slot, { at: "session.composer", render: (input) => <Bar session={input.session} /> })
}

export default setup
