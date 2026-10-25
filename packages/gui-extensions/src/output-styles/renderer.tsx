import { lazy, onCleanup, Suspense } from "solid-js"
import { onIdle, SettingsPage, type Setup } from "../sdk"
import type OutputStyles from "./index"

const setup: Setup<typeof OutputStyles> = (ctx) => {
  const OutputStyleRow = lazy(() => import("./settings"))
  onCleanup(onIdle(() => void OutputStyleRow.preload()))

  ctx.add(SettingsPage, {
    id: "output-style",
    page: "general",
    section: "general",
    get title() {
      return ctx.t("settings.title")
    },
    get entries() {
      return [{ id: "settings-output-style", title: ctx.t("settings.title"), keywords: "output style explanatory learning" }]
    },
    render: () => (
      <Suspense>
        <OutputStyleRow />
      </Suspense>
    ),
  })
}

export default setup
