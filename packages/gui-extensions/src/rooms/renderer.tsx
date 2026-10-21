import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, MenuItem, onIdle, Panel, type PanelTab, type Setup } from "../sdk"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  const layout = ctx.layout
  const sessions = ctx.sessions
  const rooms = ctx.uses.rooms
  const View = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void View.preload()))

  const key = `${ctx.id}:rooms`

  const open = () => {
    const session = sessions.current()

    if (session) layout.open(key, session)
  }

  // One tab, stable across sessions so the trigger never remounts.
  const tab: PanelTab = { id: "rooms", title: ctx.t("title") }

  ctx.add(Panel, {
    id: "main",
    region: "side",
    list: (input) => (input.open.includes("rooms") ? [tab] : []),
    render: () => (
      <Suspense>
        <View rooms={rooms} />
      </Suspense>
    ),
  })

  ctx.add(Command, {
    id: "open",
    get title() {
      return ctx.t("command.open")
    },
    get enabled() {
      return !!sessions.current()
    },
    run: open,
  })

  ctx.add(MenuItem, {
    menu: "session.panel",
    id: "open",
    get title() {
      return ctx.t("title")
    },
    icon: "grid-plus",
    order: 6,
    run: open,
  })
}

export default setup
