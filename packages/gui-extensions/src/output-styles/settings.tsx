import { OutputStylesRpc } from "@cheyenne/plugin-output-styles/rpc"
import { Select } from "@opencode/ui/select"
import { createMemo, createResource, For, Show } from "solid-js"
import { useExtension, type ServerRef } from "../sdk"
import type OutputStyles from "./index"

/** One output style picker per project of the open sessions, in the host's settings row markup. */
export default function OutputStyleRow() {
  const ctx = useExtension<typeof OutputStyles>()
  const projects = createMemo(() => [
    ...new Map(
      ctx.sessions
        .list()
        .flatMap((session) => (session.location ? [{ server: session.server, directory: session.location.directory }] : []))
        .map((project) => [`${project.server.id}\n${project.directory}`, project]),
    ).values(),
  ])

  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{ctx.t("settings.title")}</div>
        <div data-slot="settings-row-description">{ctx.t("settings.description")}</div>
      </div>
      <div data-slot="settings-row-control" data-action="settings-output-style" class="flex flex-col items-end gap-2">
        <Show when={projects().length > 0} fallback={<span>{ctx.t("settings.empty")}</span>}>
          <For each={projects()}>{(project) => <ProjectStyle {...project} />}</For>
        </Show>
      </div>
    </div>
  )
}

function ProjectStyle(props: { server: ServerRef; directory: string }) {
  const rpc = () => props.server.client.rpc(OutputStylesRpc)
  const options = { location: { directory: props.directory } }
  // A server without the output-styles plugin has no such RPC; its project shows no picker.
  const [styles, { mutate }] = createResource(() =>
    rpc()
      .list({}, options)
      .catch(() => undefined),
  )

  return (
    <Show when={styles()}>
      {(styles) => (
        <div class="flex items-center gap-2">
          <span class="text-12-regular text-v2-text-text-muted">{props.directory.split("/").pop()}</span>
          <Select
            options={styles().styles.map((style) => style.name)}
            current={styles().current}
            label={(name) => name}
            onSelect={async (name) => {
              if (!name) return
              const result = await rpc().set({ name }, options)
              mutate({ ...styles(), current: result.current })
            }}
          />
        </div>
      )}
    </Show>
  )
}
