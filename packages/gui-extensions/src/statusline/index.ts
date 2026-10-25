import { Extension } from "../sdk"
import { StatusLine } from "./contract"
import en from "./i18n/en"

// cheyenne: Claude Code's status line (`statusLine` in .claude/settings.json) in a thin bar under the composer.
export default Extension.define({
  id: "statusline",
  os: ["macos"],
  provides: { statusline: StatusLine },
  i18n: { en },
})
