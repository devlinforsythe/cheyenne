// cheyenne: the window-scoped stores behind the sidebar groups and split view. Kept apart from layout.ts so its
// pure state functions test without the persistence runtime.
import { createRoot, createSignal, getOwner } from "solid-js"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Groups, Split } from "./layout"

let groups: ReturnType<typeof createGroups> | undefined
let split: ReturnType<typeof createSplit> | undefined

// One store per window, shared by the tab strip and the shell; the first caller's owner supplies the platform context.
// The root functions take `dispose` on purpose: Solid makes a root whose function has no parameter unowned, dropping that owner.
export function useSidebarGroups() {
  const owner = getOwner()

  return (groups ??= createRoot(createGroups, owner))
}

export function useSplit() {
  const owner = getOwner()

  return (split ??= createRoot(createSplit, owner))
}

function createGroups(_dispose: VoidFunction) {
  const [state, setState, , ready] = persisted(Persist.window("cheyenne.sidebar"), Groups, { folders: [], assign: {} })

  return { state, ready, update: (fn: (state: Groups) => Groups) => setState(fn(state)) }
}

function createSplit(_dispose: VoidFunction) {
  const [state, setState, , ready] = persisted(Persist.window("cheyenne.split"), Split, { panes: [] })
  // True while a dragged tab is over the window's right edge, where dropping opens it in a split.
  const [edge, setEdge] = createSignal(false)

  return { state, ready, edge, setEdge, update: (fn: (state: Split) => Split) => setState(fn(state)) }
}
