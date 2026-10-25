import { createMemo, For, Show } from "solid-js"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Icon } from "@opencode/ui/icon"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { artifactKind } from "@opencode/util/artifact"
import { useExtension, type MountedSession } from "../sdk"

// Both tabs read tool calls already in the session's loaded history: OpenCode's `todowrite` / `write` and Claude
// Code's `TodoWrite` / `Write` (the claude-code provider keeps Claude's names), so names are matched case-blind.
function tools(session: MountedSession) {
  const id = session.id
  const list: SessionMessageInfo[] = id ? session.server.data.session.message.list(id) : []

  return list.flatMap((message) =>
    message.type === "assistant"
      ? message.content.filter((part): part is SessionMessageAssistantTool => part.type === "tool")
      : [],
  )
}

type Todo = { content: string; status: string }

export function Tasks(props: { session: MountedSession }) {
  const ctx = useExtension()

  const todos = createMemo(() => {
    const last = tools(props.session).findLast(
      (tool) => tool.name.toLowerCase() === "todowrite" && typeof tool.state.input === "object",
    )
    const input = last?.state.input

    if (!input || typeof input !== "object" || !Array.isArray(input.todos)) return []

    return input.todos as Todo[]
  })

  return (
    <ScrollView class="flex-1 min-h-0">
      <div class="flex flex-col gap-1 p-3">
        <Show when={todos().length} fallback={<div class="text-12-regular text-text-weak">{ctx.t("tasks.empty")}</div>}>
          <For each={todos()}>
            {(todo) => (
              <div class="flex items-start gap-2 py-1 text-13-regular">
                <span
                  class="mt-0.5 size-4 shrink-0 rounded border border-border-base flex items-center justify-center"
                  classList={{ "bg-surface-raised-base": todo.status === "in_progress" }}
                >
                  <Show when={todo.status === "completed"}>
                    <Icon name="check" size="small" />
                  </Show>
                </span>
                <span
                  classList={{
                    "line-through text-text-weak": todo.status === "completed" || todo.status === "cancelled",
                    "text-text-strong": todo.status === "in_progress",
                  }}
                >
                  {todo.content}
                </span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </ScrollView>
  )
}

export function Artifacts(props: { session: MountedSession }) {
  const ctx = useExtension()

  // Newest first, once each. Plain text and code stay in Changes; this lists what reads as a deliverable.
  const files = createMemo(() => {
    const paths = tools(props.session).flatMap((tool) => {
      if (tool.name.toLowerCase() !== "write" || typeof tool.state.input !== "object") return []
      const path = tool.state.input.filePath ?? tool.state.input.file_path

      return typeof path === "string" && artifactKind(path) !== "text" ? [path] : []
    })

    return [...new Set(paths.reverse())]
  })

  return (
    <ScrollView class="flex-1 min-h-0">
      <div class="flex flex-col p-2">
        <Show
          when={files().length}
          fallback={<div class="p-1 text-12-regular text-text-weak">{ctx.t("artifacts.empty")}</div>}
        >
          <For each={files()}>
            {(path) => (
              <button
                type="button"
                class="flex flex-col items-start rounded px-2 py-1.5 text-start hover:bg-surface-raised-base-hover"
                onClick={() => ctx.links.open({ href: path, exact: true, session: props.session })}
              >
                <span class="text-13-medium text-text-strong truncate max-w-full">{path.split("/").at(-1)}</span>
                <span class="text-11-regular text-text-weak truncate max-w-full">
                  {artifactKind(path)} · {path}
                </span>
              </button>
            )}
          </For>
        </Show>
      </div>
    </ScrollView>
  )
}
