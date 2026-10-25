import { Extension } from "../sdk"
import en from "./i18n/en"

// cheyenne: Claude Code output styles (Gap 3), chosen per project; the server half is @cheyenne/plugin-output-styles.
export default Extension.define({
  id: "output-styles",
  i18n: { en },
})
