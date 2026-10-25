// cheyenne: sidebar sections and groups, and split view, matching the Claude Desktop Code tab. Window-scoped like tabs.
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { ServerKey } from "@/runtime/server/persistence"
import { uuid } from "@/runtime/persistence/uuid"

export const Folder = Persistence.struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(["section", "group"]),
  // Only a group may have a parent, and only a section: one level of nesting.
  parent: Persistence.optional(Schema.String),
  collapsed: Persistence.optional(Schema.Boolean),
})

export const Groups = Persistence.struct({
  folders: Persistence.array(Folder),
  // Tab key to folder id. A tab without an entry sits above every folder.
  assign: Persistence.record(Schema.String),
})

export const Pane = Persistence.struct({ server: ServerKey, sessionId: Schema.String, width: Schema.Finite })

export const Split = Persistence.struct({ panes: Persistence.array(Pane) })

export type Folder = typeof Folder.Type
export type Groups = typeof Groups.Type
export type Pane = typeof Pane.Type
export type Split = typeof Split.Type
export type Row = { type: "folder"; id: string; depth: number } | { type: "tab"; key: string; depth: number }

export const MAX_PANES = 3

export function addFolder(state: Groups, name: string, kind: Folder["kind"], parent?: string): Groups {
  const host = parent ? state.folders.find((folder) => folder.id === parent && folder.kind === "section") : undefined
  const folder = { id: uuid(), name, kind, ...(kind === "group" && host ? { parent: host.id } : {}) }

  return { ...state, folders: [...state.folders, folder] }
}

export function updateFolder(state: Groups, id: string, patch: Partial<Pick<Folder, "name" | "collapsed">>): Groups {
  return { ...state, folders: state.folders.map((folder) => (folder.id === id ? { ...folder, ...patch } : folder)) }
}

/** Deleting keeps the sessions: they move up to the parent section, or out of every folder. Child groups move up too. */
export function removeFolder(state: Groups, id: string): Groups {
  const removed = state.folders.find((folder) => folder.id === id)

  if (!removed) return state

  const folders = state.folders
    .filter((folder) => folder.id !== id)
    .map((folder) => (folder.parent === id ? { ...folder, parent: undefined } : folder))

  const assign = Object.fromEntries(
    Object.entries(state.assign).flatMap(([key, folder]) => {
      if (folder !== id) return [[key, folder]]

      return removed.parent ? [[key, removed.parent]] : []
    }),
  )

  return { folders, assign }
}

export function assignTab(state: Groups, key: string, folder: string | undefined): Groups {
  const assign = { ...state.assign }

  if (folder && state.folders.some((item) => item.id === folder)) assign[key] = folder
  else delete assign[key]

  return { ...state, assign }
}

/** The sidebar's rows in order: loose tabs, then each top-level folder with its tabs and, for a section, its groups. */
export function sidebarRows(keys: string[], state: Groups): Row[] {
  const known = new Set(state.folders.map((folder) => folder.id))
  const folderOf = (key: string) => (known.has(state.assign[key]) ? state.assign[key] : undefined)
  const tabs = (folder: string | undefined, depth: number) =>
    keys.filter((key) => folderOf(key) === folder).map((key): Row => ({ type: "tab", key, depth }))

  const folder = (item: Folder, depth: number): Row[] => [
    { type: "folder", id: item.id, depth },
    ...(item.collapsed
      ? []
      : [
          ...tabs(item.id, depth + 1),
          ...state.folders.filter((child) => child.parent === item.id).flatMap((child) => folder(child, depth + 1)),
        ]),
  ]

  return [
    ...tabs(undefined, 0),
    ...state.folders.filter((item) => !item.parent || !known.has(item.parent)).flatMap((item) => folder(item, 0)),
  ]
}

export function openPane(state: Split, server: Pane["server"], sessionId: string, width = 480): Split {
  if (state.panes.some((pane) => pane.server === server && pane.sessionId === sessionId)) return state

  return { panes: [...state.panes, { server, sessionId, width }].slice(-MAX_PANES) }
}

export function closePane(state: Split, index: number): Split {
  return { panes: state.panes.filter((_, i) => i !== index) }
}
