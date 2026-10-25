import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { ServerKey } from "@/runtime/server/persistence"
import {
  addFolder,
  assignTab,
  closePane,
  Groups,
  openPane,
  removeFolder,
  sidebarRows,
  Split,
  updateFolder,
} from "./layout"

const server = ServerKey.make("local\nhttp://localhost:4096")
const groupsCodec = Schema.fromJsonString(Persistence.withInitial(Groups, { folders: [], assign: {} }))
const splitCodec = Schema.fromJsonString(Persistence.withInitial(Split, { panes: [] }))

describe("cheyenne layout", () => {
  test("groups save, restore and keep their sessions when deleted", () => {
    const withSection = addFolder({ folders: [], assign: {} }, "Work", "section")
    const section = withSection.folders[0].id
    const withGroup = addFolder(withSection, "Bugs", "group", section)
    const group = withGroup.folders[1].id
    const state = assignTab(assignTab(updateFolder(withGroup, group, { name: "Fixes" }), "b", group), "c", section)

    const restored = Schema.decodeUnknownSync(groupsCodec)(Schema.encodeSync(groupsCodec)(state))

    expect(restored).toEqual(state)
    expect(sidebarRows(["a", "b", "c"], restored)).toEqual([
      { type: "tab", key: "a", depth: 0 },
      { type: "folder", id: section, depth: 0 },
      { type: "tab", key: "c", depth: 1 },
      { type: "folder", id: group, depth: 1 },
      { type: "tab", key: "b", depth: 2 },
    ])
    expect(sidebarRows(["a", "b", "c"], updateFolder(restored, section, { collapsed: true }))).toHaveLength(2)

    // A group nests only inside a section, never inside another group.
    expect(addFolder(restored, "Deep", "group", group).folders[2].parent).toBeUndefined()

    const removed = removeFolder(restored, group)
    expect(removed.assign).toEqual({ b: section, c: section })
    expect(removeFolder(removed, section)).toEqual({ folders: [], assign: {} })
  })

  test("split panes save, restore, dedupe and close", () => {
    const state = openPane(openPane(openPane({ panes: [] }, server, "one"), server, "two", 300), server, "one")
    const restored = Schema.decodeUnknownSync(splitCodec)(Schema.encodeSync(splitCodec)(state))

    expect(restored.panes.map((pane) => [pane.sessionId, pane.width])).toEqual([
      ["one", 480],
      ["two", 300],
    ])
    expect(closePane(restored, 0).panes.map((pane) => pane.sessionId)).toEqual(["two"])
  })
})
