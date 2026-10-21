import { Extension } from "../sdk"
import { Rooms } from "./contract"
import en from "./i18n/en"

// cheyenne: the Rooms side tab (the owner's pick, 2026-10-20): Agent Kanban, Loop, Pipeline and Mastermind.
export default Extension.define({
  id: "rooms",
  os: ["macos"],
  provides: { rooms: Rooms },
  i18n: { en },
})
