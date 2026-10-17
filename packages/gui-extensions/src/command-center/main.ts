import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { MainSetup } from "../sdk/main"
import { CommandCenter, type Row } from "./contract"
import type definition from "./index"
import { stores } from "./stores"
import { tab, writable } from "./tabs"

const BASE = "https://api.airtable.com/v0/appLcCdYRMLbuEQ7R"

const TASKS = "tblkQ2BYy7QdCNEqQ"

const EVENTS = "tbl5U3rnZZ8BRQboD"

const REQUESTS = "tblVmkhf03V3J0u37"

// Only text, single-select and date fields are read, and Airtable sends each of those as a string.
type Fields = Readonly<Record<string, string | undefined>>

type Page = { records?: { id: string; fields: Fields }[]; offset?: string; id?: string; fields?: Fields }

const text = (value: Fields[string]) => value || undefined

// The same token the mail-job uses: AIRTABLE_TOKEN in the environment, else its line in ~/.hermes/.env.
const token = async () => {
  if (process.env.AIRTABLE_TOKEN) return process.env.AIRTABLE_TOKEN
  const env = await readFile(join(homedir(), ".hermes", ".env"), "utf8").catch(() => "")
  const line = env.split("\n").find((item) => item.startsWith("AIRTABLE_TOKEN="))
  const value = line?.slice("AIRTABLE_TOKEN=".length).trim().replace(/^"|"$/g, "")

  if (!value) throw new Error("AIRTABLE_TOKEN is not set (environment or ~/.hermes/.env)")

  return value
}

const call = async (path: string, signal: AbortSignal, init?: { method: string; body: string }) => {
  const response = await fetch(`${BASE}/${path}`, {
    ...init,
    signal,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
  })

  if (!response.ok) throw new Error(`Airtable ${response.status}: ${(await response.text()).slice(0, 200)}`)

  // SAFETY: Airtable's list endpoint answers { records, offset }; fields are read through `text` only.
  return (await response.json()) as Page
}

// Every page of a filtered list, sorted as given.
const list = async (table: string, params: Record<string, string>, signal: AbortSignal) => {
  const rows: { id: string; fields: Fields }[] = []
  const query = new URLSearchParams(params)

  for (;;) {
    const page = await call(`${table}?${query}`, signal)
    rows.push(...(page.records ?? []))

    if (!page.offset) return rows
    query.set("offset", page.offset)
  }
}

// A login shell, so the app finds ~/bin (brain, cheyenne-mission) and their runtimes like the owner's terminal does.
// Arguments go in as $0 "$@", never into the script.
const shell = (argv: string[], signal: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      "/bin/zsh",
      ["-lc", 'exec "$0" "$@"', ...argv],
      { signal, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout)),
    )
  })

const known = (id: string) => {
  const value = tab(id)
  if (!value) throw new Error(`No Command Center tab "${id}"`)
  return value
}

// Writes only the fields the tab allows, so the window can't reach the rest of the base.
const allowed = (id: string, fields: Record<string, string | null>) => {
  const keys = writable(known(id))
  const bad = Object.keys(fields).filter((key) => !keys.has(key))
  if (bad.length) throw new Error(`Not editable here: ${bad.join(", ")}`)
  return fields
}

const setup: MainSetup<typeof definition> = (ctx) => {
  ctx.provide(CommandCenter, {
    airtable: async (_, caller) => {
      const [todos, events, requests] = await Promise.all([
        list(
          TASKS,
          {
            filterByFormula: "AND({Status}!='Done',{Task}!='')",
            "sort[0][field]": "Priority",
            "sort[1][field]": "Target date",
          },
          caller.signal,
        ),
        list(
          EVENTS,
          {
            filterByFormula: "AND(IS_AFTER({Start},DATEADD(TODAY(),-1,'days')),{Status}!='Cancelled')",
            "sort[0][field]": "Start",
            maxRecords: "12",
          },
          caller.signal,
        ),
        list(REQUESTS, { filterByFormula: "{Status}='New'" }, caller.signal),
      ])

      return {
        todos: todos.map((row) => ({
          id: row.id,
          title: text(row.fields.Task) ?? "",
          status: text(row.fields.Status) ?? "To do",
          priority: text(row.fields.Priority),
          category: text(row.fields.Category),
          target: text(row.fields["Target date"]),
        })),
        events: events.map((row) => ({
          id: row.id,
          title: text(row.fields.Event) ?? "",
          start: text(row.fields.Start) ?? "",
          end: text(row.fields.End),
          calendar: text(row.fields.Calendar),
          status: text(row.fields.Status),
          location: text(row.fields.Location),
        })),
        requests: requests.map((row) => ({
          id: row.id,
          title: text(row.fields.Request) ?? "",
          from: text(row.fields.From),
        })),
      }
    },
    brief: (_, caller) => shell(["brain", "context", "--all"], caller.signal),
    // cheyenne C3: missions live in ~/.cheyenne/missions; the CLI is packages/plugins/workers/mission.ts.
    missions: async (_, caller) => JSON.parse(await shell(["cheyenne-mission", "list", "--json"], caller.signal)),
    approve: async (input, caller) => void (await shell(["cheyenne-mission", "approve", input.id], caller.signal)),
    rows: async (input, caller) => {
      const value = known(input.tab)
      if (value.source) return stores[value.source](caller.signal)
      // ponytail: ids go into one OR() formula; Airtable caps formulas near 16k chars, plenty for an event's emails.
      const ids = input.ids?.filter((id) => /^rec[A-Za-z0-9]{14}$/.test(id))
      if (ids && !ids.length) return []
      const params: Record<string, string> = {}
      const filter = ids ? `OR(${ids.map((id) => `RECORD_ID()='${id}'`).join(",")})` : value.filter
      if (filter) params.filterByFormula = filter
      value.sort?.forEach((field, index) => (params[`sort[${index}][field]`] = field))
      // SAFETY: Airtable sends JSON field values; the narrower Fields type is only how the Today lists read them.
      return (await list(value.table, params, caller.signal)) as unknown as (typeof Row.Type)[]
    },
    update: async (input, caller) => {
      await call(`${known(input.tab).table}/${input.id}`, caller.signal, {
        method: "PATCH",
        body: JSON.stringify({ fields: allowed(input.tab, input.fields), typecast: true }),
      })
    },
    create: async (input, caller) => {
      const value = known(input.tab)
      if (!value.create) throw new Error(`Tab "${input.tab}" has no New`)
      const row = await call(value.table, caller.signal, {
        method: "POST",
        body: JSON.stringify({ fields: { ...value.create.fields, [value.create.field]: input.text }, typecast: true }),
      })
      return { id: row.id ?? "", fields: row.fields ?? {} } as unknown as typeof Row.Type
    },
    setStatus: async (input) => {
      await call(`${TASKS}/${input.id}`, ctx.scope.signal, {
        method: "PATCH",
        body: JSON.stringify({ fields: { Status: input.status } }),
      })
    },
  })
}

export default setup
