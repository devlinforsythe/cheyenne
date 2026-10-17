// cheyenne 6.0b: read-only store tabs. Main fetches; the window gets plain { id, fields } rows like an Airtable tab,
// and tabs.ts gives these tabs no status/edit/create, so `allowed` refuses every write. Only GETs and one GraphQL
// query leave here.
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export type Source = "shopify" | "shipstation" | "reverb"

type Row = { id: string; fields: Record<string, string> }

const ENV = join(homedir(), ".config", "wolfe-sync", "env")

const keychain = (name: string) =>
  new Promise<string>((resolve) =>
    execFile("/usr/bin/security", ["find-generic-password", "-s", name, "-w"], (error, stdout) =>
      resolve(error ? "" : stdout.trim()),
    ),
  )

// A credential from the environment, else its line in ~/.config/wolfe-sync/env, else the Keychain (service = name).
// It stays in main; errors name where to put it, never the value.
export const secret = async (name: string) => {
  if (process.env[name]) return process.env[name]
  const env = await readFile(ENV, "utf8").catch(() => "")
  const line = env.split("\n").find((item) => item.startsWith(`${name}=`))
  const value = line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || (await keychain(name))
  if (!value) throw new Error(`${name} is not set: add it to ~/.config/wolfe-sync/env or the Keychain (service "${name}")`)
  return value
}

const day = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""

const money = (amount: string | number | undefined, currency = "USD") =>
  amount === undefined ? "" : Number(amount).toLocaleString("en-US", { style: "currency", currency })

const ORDERS = `query Orders($query: String!) {
  orders(first: 50, sortKey: CREATED_AT, reverse: true, query: $query) {
    nodes {
      id name createdAt note displayFinancialStatus displayFulfillmentStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 20) { nodes { title quantity sku } }
    }
  }
}`

type ShopifyOrder = {
  id: string
  name: string
  createdAt: string
  note: string | null
  displayFinancialStatus: string | null
  displayFulfillmentStatus: string
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
  lineItems: { nodes: { title: string; quantity: number; sku: string | null }[] }
}

const status = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/_/g, " ")

export const shopifyRow = (order: ShopifyOrder, store: string): Row => ({
  id: order.id,
  fields: {
    Order: `${order.name} · ${money(order.totalPriceSet.shopMoney.amount, order.totalPriceSet.shopMoney.currencyCode)}`,
    Date: day(order.createdAt),
    Payment: status(order.displayFinancialStatus),
    Fulfillment: status(order.displayFulfillmentStatus),
    Link: `https://admin.shopify.com/store/${store}/orders/${order.id.split("/").pop()}`,
    Items: order.lineItems.nodes.map((item) => `${item.quantity} × ${item.title}${item.sku ? ` (${item.sku})` : ""}`).join("\n"),
    Note: order.note ?? "",
  },
})

// A Dev Dashboard app gives a client ID + secret, not a token: trade them for a 24 h token (client credentials grant)
// and keep it until a minute before it runs out. A SHOPIFY_TOKEN (old-style custom app) is used as is.
type Minted = { token: string; until: number }
const shopifyToken = async (shop: string, signal: AbortSignal, minted: Minted) => {
  const fixed = await secret("SHOPIFY_TOKEN").catch(() => "")
  if (fixed) return fixed
  if (minted.until > Date.now()) return minted.token
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: await secret("SHOPIFY_CLIENT_ID"),
      client_secret: await secret("SHOPIFY_CLIENT_SECRET"),
    }),
  })
  if (!response.ok) throw new Error(`Shopify token ${response.status}: ${(await response.text()).slice(0, 200)}`)
  // SAFETY: Shopify's access_token answer is { access_token, scope, expires_in }.
  const body = (await response.json()) as { access_token: string; expires_in?: number }
  Object.assign(minted, { token: body.access_token, until: Date.now() + ((body.expires_in ?? 86400) - 60) * 1000 })
  return minted.token
}

// Open, unfulfilled orders from the last 30 days, newest first. The date bound keeps out the 2026-10-06 Matrixify
// import of old TKC orders (`#NNNN-tkc`), which are dated back to 2017.
const shopify = async (signal: AbortSignal, minted: Minted) => {
  const shop = await secret("SHOPIFY_SHOP").catch(() => "wolfe-cutlery.myshopify.com")
  const version = await secret("SHOPIFY_API_VERSION").catch(() => "2026-01")
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const response = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST",
    signal,
    headers: { "X-Shopify-Access-Token": await shopifyToken(shop, signal, minted), "Content-Type": "application/json" },
    body: JSON.stringify({
      query: ORDERS,
      variables: { query: `status:open fulfillment_status:unfulfilled created_at:>=${since}` },
    }),
  })
  if (!response.ok) throw new Error(`Shopify ${response.status}: ${(await response.text()).slice(0, 200)}`)
  // SAFETY: the shape the ORDERS query asks for; GraphQL errors arrive beside data and are raised below.
  const body = (await response.json()) as { data?: { orders: { nodes: ShopifyOrder[] } }; errors?: { message: string }[] }
  if (body.errors?.length) throw new Error(`Shopify: ${body.errors.map((error) => error.message).join("; ")}`)
  return (body.data?.orders.nodes ?? []).map((order) => shopifyRow(order, shop.replace(/\.myshopify\.com$/, "")))
}

type ShipStationOrder = {
  orderId: number
  orderNumber: string
  orderDate: string
  orderTotal: number
  requestedShippingService: string | null
  customerNotes: string | null
  shipTo: { name: string | null; city: string | null; state: string | null } | null
  items: { name: string; quantity: number; sku: string | null }[]
}

export const shipstationRow = (order: ShipStationOrder): Row => ({
  id: String(order.orderId),
  fields: {
    Order: `#${order.orderNumber} · ${money(order.orderTotal)}`,
    Date: day(order.orderDate),
    "Ship to": [order.shipTo?.name, [order.shipTo?.city, order.shipTo?.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
    Service: order.requestedShippingService ?? "",
    Items: order.items.map((item) => `${item.quantity} × ${item.name}${item.sku ? ` (${item.sku})` : ""}`).join("\n"),
    Note: order.customerNotes ?? "",
  },
})

// ShipStation API v1 (key + secret, Basic auth): every order awaiting shipment, newest first, 500 a page (the max).
const shipstation = async (signal: AbortSignal) => {
  const auth = Buffer.from(`${await secret("SHIPSTATION_API_KEY")}:${await secret("SHIPSTATION_API_SECRET")}`).toString("base64")
  const rows: Row[] = []
  for (let page = 1, pages = 1; page <= pages; page++) {
    const response = await fetch(
      `https://ssapi.shipstation.com/orders?orderStatus=awaiting_shipment&sortBy=OrderDate&sortDir=DESC&pageSize=500&page=${page}`,
      { signal, headers: { Authorization: `Basic ${auth}` } },
    )
    if (!response.ok) throw new Error(`ShipStation ${response.status}: ${(await response.text()).slice(0, 200)}`)
    // SAFETY: ShipStation's List Orders answers { orders, total, page, pages }.
    const body = (await response.json()) as { orders?: ShipStationOrder[]; pages?: number }
    rows.push(...(body.orders ?? []).map(shipstationRow))
    pages = body.pages ?? 1
  }
  return rows
}

type ReverbOrder = {
  order_number: string
  created_at: string
  title: string
  quantity: number
  sku: string | null
  status: string
  buyer_name: string | null
  total: { amount: string; currency: string }
  shipping_address: { name: string | null; locality: string | null; region: string | null } | null
  _links?: { web?: { href: string } }
}

// cheyenne 6.0c
export const reverbRow = (order: ReverbOrder): Row => ({
  id: order.order_number,
  fields: {
    Order: `#${order.order_number} · ${money(order.total.amount, order.total.currency)}`,
    Date: day(order.created_at),
    "Ship to": [
      order.shipping_address?.name ?? order.buyer_name,
      [order.shipping_address?.locality, order.shipping_address?.region].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join(" · "),
    Status: status(order.status),
    Link: order._links?.web?.href ?? `https://reverb.com/my/selling/orders/${order.order_number}`,
    Items: `${order.quantity} × ${order.title}${order.sku ? ` (${order.sku})` : ""}`,
  },
})

// Reverb API v3, personal token (read_orders scope): every order awaiting shipment, following _links.next.
const reverb = async (signal: AbortSignal) => {
  const headers = {
    Authorization: `Bearer ${await secret("REVERB_TOKEN")}`,
    Accept: "application/hal+json",
    "Accept-Version": "3.0",
  }
  const rows: Row[] = []
  for (let url: string | undefined = "https://api.reverb.com/api/my/orders/selling/awaiting_shipment?per_page=50"; url; ) {
    const response = await fetch(url, { signal, headers })
    if (!response.ok) throw new Error(`Reverb ${response.status}: ${(await response.text()).slice(0, 200)}`)
    // SAFETY: Reverb's order list answers { orders, _links: { next? } }.
    const body = (await response.json()) as { orders?: ReverbOrder[]; _links?: { next?: { href: string } } }
    rows.push(...(body.orders ?? []).map(reverbRow))
    url = body._links?.next?.href
  }
  return rows
}

// Made in main's setup, so the minted Shopify token lives with the extension, not the module.
export const stores = (): Record<Source, (signal: AbortSignal) => Promise<Row[]>> => {
  const minted: Minted = { token: "", until: 0 }
  return { shopify: (signal) => shopify(signal, minted), shipstation, reverb }
}
