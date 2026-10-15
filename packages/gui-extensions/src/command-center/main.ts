import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { MainSetup } from "../sdk/main"
import { CommandCenter } from "./contract"
import type definition from "./index"

const BASE = "https://api.airtable.com/v0/appLcCdYRMLbuEQ7R"

const TASKS = "tblkQ2BYy7QdCNEqQ"

const EVENTS = "tbl5U3rnZZ8BRQboD"

const REQUESTS = "tblVmkhf03V3J0u37"

// Only text, single-select and date fields are read, and Airtable sends each of those as a string.
type Fields = Readonly<Record<string, string | undefined>>

type Page = { records?: { id: string; fields: Fields }[]; offset?: string }

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
    setStatus: async (input) => {
      await call(`${TASKS}/${input.id}`, ctx.scope.signal, {
        method: "PATCH",
        body: JSON.stringify({ fields: { Status: input.status } }),
      })
    },
  })
}

export default setup
