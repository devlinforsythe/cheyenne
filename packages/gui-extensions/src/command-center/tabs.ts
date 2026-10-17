// cheyenne 6.0a: every Command Center table as a panel tab. Main uses table/filter/sort/fields to read and to
// check writes; the panel uses the rest to draw. Select choices are copied from the base (the token has no
// schema scope): add a choice in Airtable, add it here.

export type Tab = {
  table: string
  /** cheyenne 6.0b: read from a store (stores.ts) instead of Airtable; such a tab has no status/edit/create. */
  source?: "shopify" | "shipstation"
  title: string
  filter?: string
  sort?: string[]
  /** Short fields shown under the title. */
  meta?: string[]
  /** Long text shown when a row is opened. */
  body?: string[]
  /** The one single-select the panel can change, with its choices. */
  status?: { field: string; choices: string[] }
  /** Long-text fields the owner can edit in place. */
  edit?: string[]
  /** A New row: the field the text box fills, plus fixed fields. */
  create?: { field: string; fields?: Record<string, string> }
  /** A link field whose rows (another tab) open under the row. */
  linked?: { field: string; tab: string }
}

export const TABS = {
  tasks: {
    table: "tblkQ2BYy7QdCNEqQ",
    title: "Task",
    filter: "AND({Status}!='Done',{Task}!='')",
    sort: ["Priority", "Target date"],
    meta: ["Priority", "Category", "Target date", "Blocked by"],
    body: ["Notes"],
    status: {
      field: "Status",
      choices: ["To do", "Not started", "In progress", "Waiting on someone", "Blocked", "Done"],
    },
    edit: ["Notes", "Blocked by"],
    create: { field: "Task", fields: { Status: "To do" } },
  },
  projects: {
    table: "tbl6yIjH0PCYwau40",
    title: "Project",
    filter: "{Status}!='Shipped'",
    sort: ["Priority", "Target date"],
    meta: ["Category", "Priority", "Target date"],
    body: ["Where we left off"],
    status: { field: "Status", choices: ["Not started", "Active", "Blocked", "Paused", "Shipped"] },
    edit: ["Where we left off"],
    create: { field: "Project", fields: { Status: "Not started" } },
  },
  decisions: {
    table: "tblPK5ZaTROFwqikO",
    title: "Decision",
    filter: "{Status}='Open'",
    sort: ["Date"],
    meta: ["Business", "Date", "Source"],
    body: ["Options", "Reasoning"],
    status: { field: "Status", choices: ["Open", "Decided", "Closed"] },
    edit: ["Reasoning"],
    create: { field: "Decision", fields: { Status: "Open" } },
  },
  events: {
    table: "tbl5U3rnZZ8BRQboD",
    title: "Event",
    filter: "AND(IS_AFTER({Start},DATEADD(TODAY(),-1,'days')),{Status}!='Cancelled')",
    sort: ["Start"],
    meta: ["Start", "End", "Time", "Calendar", "Location", "Rep"],
    body: ["Notes", "Contact"],
    status: { field: "Status", choices: ["Confirmed", "Tentative", "Cancelled"] },
    edit: ["Notes"],
    linked: { field: "Event Emails", tab: "emails" },
  },
  emails: {
    table: "tblK1vVg2aa36aod6",
    title: "Subject",
    sort: ["Date"],
    meta: ["Date", "From", "Kind", "Attachment names", "Outlook link"],
    body: ["Body", "Attachment text"],
  },
  travel: {
    table: "tblA9ZDd9QqSdVurw",
    title: "Request",
    filter: "AND({Status}!='Cancelled',{Request}!='')",
    meta: ["Travelers", "Depart date", "Return date", "Budget"],
    body: ["Plan", "Booking notes"],
    // New runs the planner automation; booking stays with a person.
    status: { field: "Status", choices: ["Draft", "New", "Planning", "Options ready", "Booked", "Cancelled"] },
    edit: ["Booking notes"],
    create: { field: "Request", fields: { Status: "New", "Requested by": "Devlin (Cheyenne)" } },
  },
  accounts: {
    table: "tblRTNCPP2VwDn6yy",
    title: "Program",
    filter: "{Active}",
    meta: ["Traveler", "Type", "Member #", "Tier / status", "Login email"],
    body: ["Preferences"],
  },
  ask: {
    table: "tblVmkhf03V3J0u37",
    title: "Request",
    filter: "{Status}!='Done'",
    meta: ["From", "Last run"],
    body: ["Claude's reply"],
    status: { field: "Status", choices: ["New", "In progress", "Needs your answer", "Done", "Declined"] },
    create: { field: "Request", fields: { Status: "New", From: "Devlin (Cheyenne)" } },
  },
  shopify: {
    table: "",
    source: "shopify",
    title: "Order",
    meta: ["Date", "Payment", "Fulfillment", "Link"],
    body: ["Items", "Note"],
  },
  shipstation: {
    table: "",
    source: "shipstation",
    title: "Order",
    meta: ["Date", "Ship to", "Service"],
    body: ["Items", "Note"],
  },
} satisfies Record<string, Tab>

export type TabId = keyof typeof TABS

export const tab = (id: string): Tab | undefined => (TABS as Record<string, Tab>)[id]

// Fields a write may touch on a tab: its status, its editable texts, and what a New row sets.
export const writable = (value: Tab) =>
  new Set([
    ...(value.status ? [value.status.field] : []),
    ...(value.edit ?? []),
    ...(value.create ? [value.create.field, ...Object.keys(value.create.fields ?? {})] : []),
  ])
