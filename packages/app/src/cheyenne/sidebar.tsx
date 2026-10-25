// cheyenne: sidebar sections and groups for the vertical tab strip, matching the Claude Desktop Code tab.
import { createMemo, createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useDroppable } from "@dnd-kit/solid"
import { isSortable } from "@dnd-kit/solid/sortable"
import type { UniqueIdentifier } from "@dnd-kit/abstract"
import type { Draggable } from "@dnd-kit/dom"
import { arrayMove } from "@dnd-kit/helpers"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { tabKey, type Tab } from "@/shell/tabs/tabs"
import { sessionHref } from "@/shell/routes/session"
import type { ServerCtx } from "@/runtime/server/runtime"
import { addFolder, assignTab, openPane, removeFolder, sidebarRows, updateFolder, type Folder } from "./layout"
import { useSidebarGroups, useSplit } from "./store"

// Past this many pixels from the window's right edge, dropping a dragged tab opens it in a split.
const EDGE = 160

/** The tab strip's rows in sidebar order: the tab objects themselves, so `For` keeps them mounted, and folders. */
export function useSidebar(tabs: () => Tab[]) {
  const groups = useSidebarGroups()
  const split = useSplit()
  const rows = createMemo(() => sidebarRows(tabs().map(tabKey), groups.state))
  const items = createMemo(() =>
    rows().flatMap((row): (Tab | Folder)[] =>
      row.type === "tab"
        ? tabs().filter((tab) => tabKey(tab) === row.key)
        : groups.state.folders.filter((folder) => folder.id === row.id),
    ),
  )
  const depths = createMemo(() =>
    Object.fromEntries(rows().map((row) => [row.type === "tab" ? row.key : row.id, row.depth])),
  )

  return {
    items,
    tabs: () => items().filter((item): item is Tab => "type" in item),
    depth: (id: string) => depths()[id] ?? 0,
    move(event: { operation: { position: { current: { x: number } } } }) {
      split.setEdge(event.operation.position.current.x > window.innerWidth - EDGE)
    },
    // Runs after the strip's own reorder: a drop on a folder header files the tab there, a drop at the right edge
    // opens it in a split, and a plain reorder files it with the neighbour it moved next to.
    settle(
      event: {
        canceled: boolean
        operation: { source: Draggable | null; target: { id: UniqueIdentifier } | null }
      },
      visible: string[],
    ) {
      const edge = split.edge()
      const source = event.operation.source
      const target = event.operation.target?.id.toString()
      split.setEdge(false)

      if (event.canceled || !isSortable(source)) return
      const key = source.id.toString()

      if (edge) {
        const tab = tabs().find((item) => tabKey(item) === key)
        if (tab?.type === "session") split.update((state) => openPane(state, tab.server, tab.sessionId))
        return
      }

      if (target?.startsWith("folder:")) return groups.update((state) => assignTab(state, key, target.slice(7)))

      if (source.initialIndex === source.index) return
      const order = arrayMove(visible, source.initialIndex, source.index)
      const neighbour = order[source.index + (source.index > source.initialIndex ? -1 : 1)]
      groups.update((state) => assignTab(state, key, neighbour ? state.assign[neighbour] : undefined))
    },
  }
}

export function SidebarAdd() {
  const groups = useSidebarGroups()

  return (
    <div class="flex items-center justify-between px-2 pb-1 text-12-medium text-text-weak">
      <span>Sessions</span>
      <Menu modal={false} placement="bottom-end">
        <Menu.Trigger
          as={IconButton}
          size="small"
          variant="ghost-muted"
          icon={<Icon name="plus-small" />}
          aria-label="New section or group"
        />
        <Menu.Portal>
          <Menu.Content>
            <Menu.Item onSelect={() => groups.update((state) => addFolder(state, "New section", "section"))}>
              New section
            </Menu.Item>
            <Menu.Item onSelect={() => groups.update((state) => addFolder(state, "New group", "group"))}>
              New group
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </div>
  )
}

export function FolderHeader(props: { folder: Folder; depth: number }) {
  const groups = useSidebarGroups()
  const droppable = useDroppable({
    get id() {
      return `folder:${props.folder.id}`
    },
  })
  const [renaming, setRenaming] = createSignal(false)
  // The menu restores focus to its trigger as it closes, so the rename input opens only once that is done.
  let rename = false
  const save = (name: string) => {
    setRenaming(false)
    if (name.trim()) groups.update((state) => updateFolder(state, props.folder.id, { name: name.trim() }))
  }

  return (
    <Menu.Context modal={false}>
      <Menu.Context.Trigger
        as="div"
        ref={droppable.ref}
        data-cheyenne-folder={props.folder.kind}
        class="flex h-7 shrink-0 items-center gap-1 rounded-md pr-2 text-12-medium text-text-weak hover:bg-surface-raised-base-hover"
        classList={{ "bg-surface-raised-base-hover text-text-strong": droppable.isDropTarget() }}
        style={{ "padding-left": `${4 + props.depth * 12}px` }}
        onClick={() =>
          groups.update((state) => updateFolder(state, props.folder.id, { collapsed: !props.folder.collapsed }))
        }
      >
        <Icon name={props.folder.collapsed ? "chevron-right" : "chevron-down"} size="small" />
        <Show when={props.folder.kind === "group"}>
          <Icon name="folder" size="small" />
        </Show>
        <Show when={renaming()} fallback={<span class="truncate">{props.folder.name}</span>}>
          <input
            class="min-w-0 flex-1 bg-transparent text-text-strong outline-none"
            value={props.folder.name}
            ref={(el) => queueMicrotask(() => el.select())}
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => save(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
              if (event.key === "Escape") setRenaming(false)
            }}
          />
        </Show>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content
          onCloseAutoFocus={(event) => {
            if (!rename) return
            event.preventDefault()
            rename = false
            setRenaming(true)
          }}
        >
          <Menu.Item onSelect={() => (rename = true)}>Rename</Menu.Item>
          <Show when={props.folder.kind === "section"}>
            <Menu.Item
              onSelect={() => groups.update((state) => addFolder(state, "New group", "group", props.folder.id))}
            >
              New group
            </Menu.Item>
          </Show>
          <Menu.Item onSelect={() => groups.update((state) => removeFolder(state, props.folder.id))}>
            Delete {props.folder.kind} (keeps its sessions)
          </Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

/** Extra right-click items for a tab: file it in a section or group, or open it beside the current session. */
export function TabMenuItems(props: { tab: Tab }) {
  const groups = useSidebarGroups()
  const split = useSplit()
  const key = () => tabKey(props.tab)

  return (
    <>
      <Menu.Separator />
      <Menu.Sub>
        <Menu.SubTrigger>Move to</Menu.SubTrigger>
        <Menu.Portal>
          <Menu.SubContent>
            <Menu.Item onSelect={() => groups.update((state) => assignTab(state, key(), undefined))}>
              No section
            </Menu.Item>
            <For each={groups.state.folders}>
              {(folder) => (
                <Menu.Item onSelect={() => groups.update((state) => assignTab(state, key(), folder.id))}>
                  {folder.name}
                </Menu.Item>
              )}
            </For>
          </Menu.SubContent>
        </Menu.Portal>
      </Menu.Sub>
      <Show when={props.tab.type === "session" && props.tab}>
        {(tab) => (
          <Menu.Item onSelect={() => split.update((state) => openPane(state, tab().server, tab().sessionId))}>
            Open in split view
          </Menu.Item>
        )}
      </Show>
    </>
  )
}

/** A session's subagent sessions, nested under its tab. */
export function SessionChildren(props: { tab: Tab; serverCtx: ServerCtx | undefined; depth: number }) {
  const navigate = useNavigate()
  const children = createMemo(() => {
    const tab = props.tab

    if (tab.type !== "session") return []
    return props.serverCtx?.data.session.list().filter((session) => session.parentID === tab.sessionId) ?? []
  })

  return (
    <For each={children()}>
      {(child) => (
        <button
          type="button"
          class="flex h-6 w-full shrink-0 items-center gap-1.5 truncate rounded-md pr-2 text-start text-12-regular text-text-weak hover:bg-surface-raised-base-hover"
          style={{ "padding-left": `${20 + props.depth * 12}px` }}
          onClick={() => props.tab.type === "session" && navigate(sessionHref(props.tab.server, child.id))}
        >
          <span class="text-text-weaker">↳</span>
          <span class="truncate">{child.title}</span>
        </button>
      )}
    </For>
  )
}
