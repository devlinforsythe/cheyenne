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

/** A Cheyenne mission (C3), as `cheyenne-mission list --json` reports it. */
export const Mission = Schema.Struct({
  id: Schema.String,
  goal: Schema.String,
  worktree: Schema.String,
  branch: Schema.String,
  business: Schema.String,
  stages: Schema.Array(
    Schema.Struct({ stage: Schema.String, workers: Schema.Array(Schema.String), status: Schema.String }),
  ),
})

/** Any Command Center row (cheyenne 6.0a), fields as Airtable sends them; `tabs.ts` says which to draw. */
export const Row = Schema.Struct({ id: Schema.String, fields: Schema.Record(Schema.String, Schema.Json) })

/** A write: text or select values, `null` clears the field. Main refuses fields `tabs.ts` doesn't list for the tab. */
const Fields = Schema.Record(Schema.String, Schema.NullOr(Schema.String))

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
    /** A tab's rows (its filter and sort), or just the rows with these ids. */
    rows: { input: Schema.Struct({ tab: Schema.String, ids: Schema.optional(Schema.Array(Schema.String)) }), output: Schema.Array(Row) },
    /** Changes fields on one row of a tab. */
    update: { input: Schema.Struct({ tab: Schema.String, id: Schema.String, fields: Fields }) },
    /** Adds a row to a tab: `text` fills its create field, plus the tab's fixed fields. */
    create: { input: Schema.Struct({ tab: Schema.String, text: Schema.String }), output: Row },
    /** Open missions, newest first. */
    missions: { output: Schema.Array(Mission) },
    /** The owner's go for a mission's current stage: runs its workers (detached). */
    approve: { input: Schema.Struct({ id: Schema.String }) },
  },
})
