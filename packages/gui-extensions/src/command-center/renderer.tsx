import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, MenuItem, onIdle, Panel, type PanelTab, type Setup } from "../sdk"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  const layout = ctx.layout
  const sessions = ctx.sessions
  const center = ctx.uses.center
  const View = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void View.preload()))

  const key = `${ctx.id}:today`

  const open = () => {
    const session = sessions.current()

    if (session) layout.open(key, session)
  }

  // One tab, stable across sessions so the trigger never remounts.
  const tab: PanelTab = { id: "today", title: ctx.t("title") }

  ctx.add(Panel, {
    id: "main",
    region: "side",
    list: (input) => (input.open.includes("today") ? [tab] : []),
    render: () => (
      <Suspense>
        <View center={center} />
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
    icon: "check",
    order: 5,
    run: open,
  })
}

export default setup
