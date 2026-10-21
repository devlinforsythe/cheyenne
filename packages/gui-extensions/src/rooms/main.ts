import { execFile } from "node:child_process"
import type { MainSetup } from "../sdk/main"
import { Rooms } from "./contract"
import type definition from "./index"

// A login shell, as in the Command Center's main: the app finds ~/bin (cheyenne-rooms, cheyenne-mission) and their
// runtimes like the owner's terminal does. Arguments go in as $0 "$@", never into the script.
const shell = (argv: string[], signal: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      "/bin/zsh",
      ["-lc", 'exec "$0" "$@"', ...argv],
      { signal, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout)),
    )
  })

// Every room command prints JSON; an input goes in as one JSON argument.
const rooms = async (argv: string[], signal: AbortSignal) => JSON.parse(await shell(["cheyenne-rooms", ...argv], signal))

const setup: MainSetup<typeof definition> = (ctx) => {
  ctx.provide(Rooms, {
    read: (input, caller) => rooms(["state", ...(input.chat ? [input.chat] : [])], caller.signal),
    newCard: async (input, caller) => void (await rooms(["kanban", "new", JSON.stringify(input)], caller.signal)),
    approve: async (input, caller) => void (await shell(["cheyenne-mission", "approve", input.id], caller.signal)),
    loopStart: async (input, caller) => void (await rooms(["loop", "start", JSON.stringify(input)], caller.signal)),
    loopStop: async (input, caller) => void (await rooms(["loop", "stop", input.id], caller.signal)),
    shape: async (input, caller) => void (await rooms(["pipeline", "shape", input.id, input.planner], caller.signal)),
    approveIdea: async (input, caller) =>
      void (await rooms(["pipeline", "approve", input.id, JSON.stringify(input)], caller.signal)),
    rejectIdea: async (input, caller) => void (await rooms(["pipeline", "reject", input.id], caller.signal)),
    newChat: (input, caller) => rooms(["chat", "new", JSON.stringify(input)], caller.signal),
    say: async (input, caller) => void (await rooms(["chat", "say", input.id, JSON.stringify(input)], caller.signal)),
  })
}

export default setup
