import { Plugin } from "@opencode/plugin"
import { codex } from "./codex"
import { every, importSource } from "./common"
import { cursor } from "./cursor"
import { grok } from "./grok"

// Cheyenne: Codex, Grok CLI and Cursor agent sessions in the sidebar, beside claude-code's Claude Code ones. Imports the
// last week's sessions when the server starts and every five minutes after; common.ts says how.
// ponytail: polling, an fs watch on the source folders if 5 min is slow.
export const sources = [codex, grok, cursor]

export default Plugin.define({
  id: "cheyenne.agent-sessions",
  setup: () =>
    every("agent-sessions import", 4_000, async () => {
      for (const source of sources) await importSource(source).catch((error) => console.error(`[${source.name} import]`, error))
    }),
})
