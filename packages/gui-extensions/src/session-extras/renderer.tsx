import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, MenuItem, onIdle, Panel, type PanelTab, type Setup } from "../sdk"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  const layout = ctx.layout
  const sessions = ctx.sessions
  const Tasks = lazy(() => import("./panel").then((module) => ({ default: module.Tasks })))
  const Artifacts = lazy(() => import("./panel").then((module) => ({ default: module.Artifacts })))
  onCleanup(onIdle(() => void Tasks.preload()))

  const tabs = [
    { id: "tasks", icon: "check", order: 7, View: Tasks },
    { id: "artifacts", icon: "window-analytics", order: 8, View: Artifacts },
  ] as const

  tabs.forEach((item) => {
    const open = () => {
      const session = sessions.current()

      if (session) layout.open(`${ctx.id}:${item.id}`, session)
    }

    // One tab object, stable across sessions so the trigger never remounts.
    const tab: PanelTab = {
      id: item.id,
      get title() {
        return ctx.t(`${item.id}.title`)
      },
    }

    ctx.add(Panel, {
      id: item.id,
      region: "side",
      list: (input) => (input.open.includes(item.id) ? [tab] : []),
      render: (props) => (
        <Suspense>
          <item.View session={props.session} />
        </Suspense>
      ),
    })

    ctx.add(Command, {
      id: `open-${item.id}`,
      get title() {
        return ctx.t(`${item.id}.open`)
      },
      get enabled() {
        return !!sessions.current()
      },
      run: open,
    })

    ctx.add(MenuItem, {
      menu: "session.panel",
      id: `open-${item.id}`,
      get title() {
        return ctx.t(`${item.id}.title`)
      },
      icon: item.icon,
      order: item.order,
      run: open,
    })
  })
}

export default setup
