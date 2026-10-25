import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { createResource, createSignal, For, Show } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { SessionModel } from "./model"
import type { SessionRevert } from "./revert"
import { codeOnlyFiles, rewindPlan, type RewindMode } from "./rewind-mode"

// cheyenne: the rewind screen (Claude Code's /rewind). Both and conversation-only stage the existing session revert,
// so Redo stays the way back; code only restores the files and leaves no staged revert behind.
export function createSessionRewind(input: { session: SessionModel; revert: SessionRevert }) {
  const dialog = useDialog()
  const server = useServerSDK()
  const location = useWorkspaceLocation()
  const language = useLanguage()

  const attempt = <A,>(action: () => Promise<A>) =>
    action().catch((error) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
      return undefined
    })

  const restoreCode = async (sessionID: string, messageID: string) => {
    // Snapshot paths are relative to the project's worktree, not the session's folder.
    const at = { directory: location().current?.project.directory ?? location().directory }
    if ((await attempt(() => server.api.session.interrupt({ sessionID }))) === undefined) return
    if ((await attempt(() => server.api.session.wait({ sessionID }).then(() => true))) === undefined) return
    if (input.session.data.revertMessageID())
      if (!(await attempt(() => server.api.session.revert.clear({ sessionID }).then(() => true)))) return
    const staged = await attempt(() => server.api.session.revert.stage({ sessionID, messageID }))
    if (!staged) return
    const files = codeOnlyFiles(staged.files ?? [])
    // A failed read leaves the revert staged with the checkpoint's files; Redo puts the current ones back.
    const contents = await attempt(() =>
      Promise.all(files.write.map((path) => server.api.file.read({ path, location: at }))),
    )
    if (!contents) return
    if (!(await attempt(() => server.api.session.revert.clear({ sessionID }).then(() => true)))) return
    await attempt(() =>
      Promise.all(files.write.map((path, i) => server.api.file.write({ path, location: at, payload: contents[i]! }))),
    )
    if (files.kept.length)
      showToast({ title: language.t("session.rewind.kept"), description: files.kept.join(", ") })
  }

  const run = (messageID: string, mode: RewindMode) => {
    const sessionID = input.session.identity.params.id
    if (!sessionID) return
    if (mode === "code") return restoreCode(sessionID, messageID)
    return input.revert.to(messageID, rewindPlan(mode).files)
  }

  const open = (messageID?: string) => {
    if (!input.session.identity.params.id || input.session.history.visibleUserMessages().length === 0) return
    dialog.show(() => <RewindDialog session={input.session} initial={messageID} run={run} />)
  }

  return { open }
}

function RewindDialog(props: {
  session: SessionModel
  initial?: string
  run: (messageID: string, mode: RewindMode) => Promise<void> | undefined
}) {
  const dialog = useDialog()
  const server = useServerSDK()
  const language = useLanguage()
  const [selected, setSelected] = createSignal(props.initial)
  const [mode, setMode] = createSignal<RewindMode>("both")
  const [busy, setBusy] = createSignal(false)
  const messages = () => props.session.history.visibleUserMessages()
  const later = () => {
    const index = messages().findIndex((message) => message.id === selected())
    return index < 0 ? 0 : messages().length - index
  }

  // The files the agent changed from the checkpoint's turn through the last one: what a code restore puts back.
  const [changed] = createResource(
    () => {
      const sessionID = props.session.identity.params.id
      const from = selected()
      return sessionID && from ? { sessionID, from, to: messages().at(-1)?.id } : undefined
    },
    (query) =>
      server.api.session
        .diff({ ...query, to: query.to === query.from ? undefined : query.to, context: 0 })
        .catch(() => []),
  )

  const loss = () => {
    const plan = rewindPlan(mode())
    const files = changed()?.length ?? 0
    return [
      plan.conversation
        ? language.t("session.rewind.loss.conversation", { count: later() })
        : language.t("session.rewind.keep.conversation"),
      plan.files
        ? language.t("session.rewind.loss.files", { count: files })
        : language.t("session.rewind.keep.files"),
      plan.conversation
        ? language.t("session.rewind.back.redo")
        : language.t("session.rewind.back.none"),
    ]
  }

  const confirm = async () => {
    const id = selected()
    if (!id || busy()) return
    setBusy(true)
    await props.run(id, mode())
    setBusy(false)
    dialog.close()
  }

  const modes: RewindMode[] = ["both", "conversation", "code"]

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("session.rewind.title")}
          description={selected() ? language.t("session.rewind.mode") : language.t("session.rewind.pick")}
        />
      </DialogHeader>
      <DialogBody class="flex max-h-[60vh] flex-col gap-2 overflow-y-auto px-4 pb-2">
        <Show
          when={selected()}
          fallback={
            <For each={[...messages()].reverse()}>
              {(message) => (
                <button
                  type="button"
                  class="flex w-full flex-col items-start rounded-md px-3 py-2 text-left text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus:bg-v2-overlay-simple-overlay-hover focus:outline-none"
                  onClick={() => setSelected(message.id)}
                >
                  <span class="w-full truncate">{message.text.split("\n")[0] || language.t("common.attachment")}</span>
                  <span class="text-[12px] text-v2-text-text-muted">
                    {new Date(message.time.created).toLocaleString()}
                  </span>
                </button>
              )}
            </For>
          }
        >
          <div class="truncate rounded-md bg-v2-background-bg-layer-02 px-3 py-2 text-[13px] text-v2-text-text-base">
            {messages().find((message) => message.id === selected())?.text.split("\n")[0]}
          </div>
          <div role="radiogroup" class="flex flex-col gap-1">
            <For each={modes}>
              {(item) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode() === item}
                  class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus:outline-none aria-checked:bg-v2-overlay-simple-overlay-hover"
                  onClick={() => setMode(item)}
                >
                  <span>{mode() === item ? "●" : "○"}</span>
                  {language.t(`session.rewind.mode.${item}`)}
                </button>
              )}
            </For>
          </div>
          <div data-component="rewind-loss" class="flex flex-col gap-1 px-1 text-[13px] text-v2-text-text-muted">
            <For each={loss().slice(0, 2)}>{(line) => <p>{line}</p>}</For>
            <Show when={rewindPlan(mode()).files && changed()?.length}>
              <ul class="list-disc pl-5">
                <For each={changed()}>{(file) => <li class="truncate">{file.file}</li>}</For>
              </ul>
            </Show>
            <p>{loss()[2]}</p>
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Show when={selected()} fallback={<Button variant="ghost" onClick={() => dialog.close()}>{language.t("common.cancel")}</Button>}>
          <Button variant="ghost" onClick={() => setSelected(undefined)}>
            {language.t("session.rewind.back")}
          </Button>
          <Button variant="danger" disabled={busy()} onClick={confirm}>
            {language.t("session.rewind.confirm")}
          </Button>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}
