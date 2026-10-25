import { Schema } from "effect"
import { Ipc } from "../sdk"

/**
 * Runs the user's status line command, as Claude Code does: `statusLine: { type: "command", command, padding }` from
 * ~/.claude/settings.json, the project's .claude/settings.json (and settings.local.json), or opencode.jsonc. The
 * payload goes in on stdin; the first line of stdout comes back. No setting, a failure or a timeout gives "".
 */
export const StatusLine = Ipc.define({
  id: "statusline",
  methods: {
    /** The first line the command prints for this payload, run in `directory`, and the setting's padding. */
    run: {
      input: Schema.Struct({ directory: Schema.String, payload: Schema.String }),
      output: Schema.Struct({ line: Schema.String, padding: Schema.Number }),
    },
  },
})
