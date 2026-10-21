import { Plugin } from "@opencode/plugin"
import { every } from "../agent-sessions/common"
import { importRecent } from "./imports"

// Cheyenne: Claude Code sessions in the sidebar. Imports the last week's transcripts when the server starts and
// every five minutes after; imports.ts says how. ponytail: polling, an fs watch on ~/.claude/projects if 5 min is slow.
export default Plugin.define({
  id: "cheyenne.claude-code",
  setup: () => every("claude-code import", 2_000, importRecent),
})
