import { expect, test } from "bun:test"
import { secret, shipstationRow, shopifyRow } from "./stores"
import { TABS, writable } from "./tabs"

test("a Shopify order becomes a row with an admin link", () => {
  const row = shopifyRow(
    {
      id: "gid://shopify/Order/5551234",
      name: "#1042",
      createdAt: "2026-10-15T18:00:00Z",
      note: null,
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "UNFULFILLED",
      totalPriceSet: { shopMoney: { amount: "349.00", currencyCode: "USD" } },
      lineItems: { nodes: [{ title: "Chef 8in", quantity: 2, sku: "WC-8" }] },
    },
    "wolfe-cutlery",
  )
  expect(row.fields.Order).toBe("#1042 · $349.00")
  expect(row.fields.Fulfillment).toBe("unfulfilled")
  expect(row.fields.Link).toBe("https://admin.shopify.com/store/wolfe-cutlery/orders/5551234")
  expect(row.fields.Items).toBe("2 × Chef 8in (WC-8)")
})

test("a ShipStation order becomes a row", () => {
  const row = shipstationRow({
    orderId: 9,
    orderNumber: "1042",
    orderDate: "2026-10-15T10:00:00.0000000",
    orderTotal: 349,
    requestedShippingService: "UPS Ground",
    customerNotes: null,
    shipTo: { name: "A Buyer", city: "Tulsa", state: "OK" },
    items: [{ name: "Chef 8in", quantity: 1, sku: null }],
  })
  expect(row).toMatchObject({ id: "9", fields: { Order: "#1042 · $349.00", "Ship to": "A Buyer · Tulsa, OK", Items: "1 × Chef 8in" } })
})

test("store tabs allow no writes", () => {
  expect(writable(TABS.shopify).size).toBe(0)
  expect(writable(TABS.shipstation).size).toBe(0)
})

test("a missing credential names where to put it", async () => {
  await expect(secret("CHEYENNE_TEST_NO_SUCH_SECRET")).rejects.toThrow("~/.config/wolfe-sync/env")
})
