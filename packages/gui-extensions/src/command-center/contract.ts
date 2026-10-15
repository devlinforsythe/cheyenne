import { Schema } from "effect"
import { Ipc } from "../sdk"

/** An open row of the Command Center's Tasks table. */
export const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
  priority: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
})

/** An upcoming row of the Events table. */
export const Event = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  start: Schema.String,
  end: Schema.optional(Schema.String),
  calendar: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
})

/** A New row of the Requests table. */
export const Request = Schema.Struct({ id: Schema.String, title: Schema.String, from: Schema.optional(Schema.String) })

/**
 * Cheyenne's Command Center: the owner's Airtable base (`appLcCdYRMLbuEQ7R`) and the `brain` briefing. Main reads
 * the Airtable token from the environment or `~/.hermes/.env`, so it never reaches the window.
 */
export const CommandCenter = Ipc.define({
  id: "command-center",
  methods: {
    /** Open to-dos, upcoming Events and New Requests. Rejects when the token is missing or Airtable fails. */
    airtable: {
      output: Schema.Struct({ todos: Schema.Array(Todo), events: Schema.Array(Event), requests: Schema.Array(Request) }),
    },
    /** The output of `brain context --all`. */
    brief: { output: Schema.String },
    /** Sets a to-do's Status, e.g. "Done", or back to what it was. */
    setStatus: { input: Schema.Struct({ id: Schema.String, status: Schema.String }) },
  },
})
