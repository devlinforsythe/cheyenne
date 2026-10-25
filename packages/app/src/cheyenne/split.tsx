// cheyenne: split view, sessions side by side beside the main route, matching the Claude Desktop Code tab.
import { For, Show, Suspense, useContext, type ParentProps } from "solid-js"
import { RouterContext } from "@solidjs/router"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { base64Encode } from "@opencode/util/encode"
import { SessionRouteFrame } from "@/session/session-frame"
import { TargetServerRoute, TargetSessionRouteContent } from "@/shell/routes/routes"
import { closePane } from "./layout"
import { useSplit } from "./store"

export function SplitView(props: ParentProps) {
  const split = useSplit()
  const router = useContext(RouterContext)

  return (
    <div class="relative flex min-h-0 w-full flex-1">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col items-start">{props.children}</div>
      <Show when={router}>
        {(router) => (
          <For each={split.state.panes}>
            {(pane, index) => (
              <div
                data-cheyenne-split-pane
                class="relative flex min-h-0 shrink-0 flex-col border-s border-border-weak-base"
                style={{ width: `${pane.width}px` }}
              >
                <ResizeHandle
                  class="-start-1 z-30"
                  direction="horizontal"
                  edge="start"
                  size={pane.width}
                  min={320}
                  max={1400}
                  onResize={(width) =>
                    split.update((state) => ({
                      panes: state.panes.map((item, i) => (i === index() ? { ...item, width } : item)),
                    }))
                  }
                />
                {/* Its own bar: the session header's buttons would cover a button laid over it. */}
                <div class="flex h-7 shrink-0 items-center justify-end px-2">
                  <IconButton
                    size="small"
                    variant="ghost-muted"
                    icon={<Icon name="xmark-small" />}
                    aria-label="Close split"
                    onClick={() => split.update((state) => closePane(state, index()))}
                  />
                </div>
                {/* ponytail: only the route params are per pane; navigation, hash and keybindings stay with the main pane. */}
                <RouterContext.Provider
                  value={Object.assign(Object.create(router()), {
                    params: { serverKey: base64Encode(pane.server), id: pane.sessionId },
                  })}
                >
                  <SessionRouteFrame>
                    <Suspense>
                      <TargetServerRoute>
                        <TargetSessionRouteContent />
                      </TargetServerRoute>
                    </Suspense>
                  </SessionRouteFrame>
                </RouterContext.Provider>
              </div>
            )}
          </For>
        )}
      </Show>
      <Show when={split.edge()}>
        <div class="pointer-events-none absolute inset-y-2 end-2 z-40 flex w-1/3 items-center justify-center rounded-lg border-2 border-dashed border-border-strong-base bg-surface-raised-base/60 text-14-medium text-text-strong">
          Open in split view
        </div>
      </Show>
    </div>
  )
}
