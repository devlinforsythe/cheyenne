import { Extension } from "../sdk"
import { CommandCenter } from "./contract"
import en from "./i18n/en"

// cheyenne: the Command Center panel (plan step C1).
export default Extension.define({
  id: "command-center",
  os: ["macos", "linux"], // cheyenne linux
  provides: { center: CommandCenter },
  i18n: { en },
})
