import { Schema } from "effect"
import { Ipc } from "../sdk"

const Id = Schema.Struct({ id: Schema.String })

const Names = Schema.Array(Schema.String)

/** A mission on the Agent Kanban; `column` is the role of the stage it is on: planner, builder, reviewer or done. */
export const Card = Schema.Struct({
  id: Schema.String,
  goal: Schema.String,
  business: Schema.String,
  column: Schema.String,
  stage: Schema.String,
  status: Schema.String,
  workers: Names,
  summary: Schema.String,
})

/** A Loop: a builder in a mission's worktree, judged read-only by a different model, round after round until PASS. */
export const Loop = Schema.Struct({
  id: Schema.String,
  mission: Schema.String,
  done: Schema.String,
  builder: Schema.String,
  judge: Schema.String,
  rounds: Schema.Number,
  status: Schema.String,
  created: Schema.String,
  finished: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
  history: Schema.Array(
    Schema.Struct({
      round: Schema.Number,
      builder: Schema.String,
      seconds: Schema.Number,
      verdict: Schema.String,
      feedback: Schema.String,
    }),
  ),
})

/** An open idea from the ideas inbox and its Pipeline stage: new, shaping, review, approved, rejected or failed. */
export const Idea = Schema.Struct({
  id: Schema.String,
  idea: Schema.String,
  business: Schema.String,
  project: Schema.String,
  status: Schema.String,
  stage: Schema.String,
  planner: Schema.optional(Schema.String),
  plan: Schema.optional(
    Schema.Struct({
      route: Schema.String,
      business: Schema.String,
      title: Schema.String,
      repo: Schema.String,
      why: Schema.String,
      stages: Schema.Array(Schema.Struct({ stage: Schema.String, workers: Names, brief: Schema.String })),
    }),
  ),
  mission: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})

/** One Mastermind chat: who is in it, the transcript, who still owes a reply and who is replying now. */
export const Chat = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  present: Names,
  messages: Schema.Array(
    Schema.Struct({ from: Schema.String, text: Schema.String, at: Schema.String, error: Schema.optional(Schema.Boolean) }),
  ),
  pending: Names,
  typing: Schema.optional(Schema.String),
})

/** Every room at once (`cheyenne-rooms state`), the names its forms pick from, and the open Mastermind chat. */
export const State = Schema.Struct({
  cards: Schema.Array(Card),
  businesses: Names,
  workers: Names,
  agents: Names,
  loops: Schema.Array(Loop),
  ideas: Schema.Array(Idea),
  chats: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String, updated: Schema.String, count: Schema.Number })),
  chat: Schema.optional(Chat),
})

/**
 * Cheyenne's rooms. Main runs the `cheyenne-rooms` CLI (packages/plugins/workers/rooms.ts) in a login shell; its long
 * jobs (a loop, an idea being planned, a chat's replies) run detached, so they outlive the window. A refusal rejects
 * with the CLI's message.
 */
export const Rooms = Ipc.define({
  id: "rooms",
  methods: {
    /** Every room at once, with the chat `chat` names open (else the newest; an unknown id, such as "new", opens none).
     * Not `state`: an Ipc client keeps `state()` and `on()` for itself, and the types merge without an error. */
    read: { input: Schema.Struct({ chat: Schema.optional(Schema.String) }), output: State },
    /** A new Kanban card: a mission on the default stages, each waiting for the owner's Approve. */
    newCard: { input: Schema.Struct({ goal: Schema.String, business: Schema.String, repo: Schema.optional(Schema.String) }) },
    /** The owner's go for a card's current stage (`cheyenne-mission approve`). */
    approve: { input: Id },
    /** Starts a loop in a mission's worktree. */
    loopStart: {
      input: Schema.Struct({
        mission: Schema.String,
        done: Schema.String,
        builder: Schema.String,
        judge: Schema.String,
        rounds: Schema.Number,
      }),
    },
    /** Stops a running loop and its builder. */
    loopStop: { input: Id },
    /** A read-only agent classifies and plans an idea. */
    shape: { input: Schema.Struct({ id: Schema.String, planner: Schema.String }) },
    /** The owner's one approval: `idea doing <id>`, then a mission whose stages all run without pausing. */
    approveIdea: { input: Schema.Struct({ id: Schema.String, repo: Schema.optional(Schema.String) }) },
    /** Sets a planned idea aside. */
    rejectIdea: { input: Id },
    /** A new chat with these agents in it. */
    newChat: { input: Schema.Struct({ present: Names }), output: Id },
    /** The owner's message: the @-tagged agents reply, else everyone present, one at a time. */
    say: { input: Schema.Struct({ id: Schema.String, text: Schema.String, present: Names }) },
  },
})
