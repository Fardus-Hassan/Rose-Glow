import { pool } from "./db.js"
import { fail, mobile, money, noteText } from "./http.js"
import { createOrder, getOrder } from "./orders.js"

function shopMobile(value) {
  const digits = String(value ?? "").replace(/\D/g, "")
  const local = digits.startsWith("880") ? `0${digits.slice(3)}` : digits
  const phone = mobile(local)
  if (!phone) throw fail(400, "Enter an 11-digit mobile number starting with 01")
  return phone
}

export function assertShopKey(header) {
  const key = process.env.SHOP_INGEST_KEY || ""
  if (!key) throw fail(503, "Shop key is not set")
  if (String(header || "") !== key) throw fail(401, "Shop key is not valid")
}

async function websiteSource() {
  const found = await pool.query(`SELECT id FROM order_sources WHERE lower(name) = 'website' ORDER BY id LIMIT 1`)
  if (found.rows[0]) return found.rows[0].id
  const inserted = await pool.query(`INSERT INTO order_sources (name, position) VALUES ('Website', 0) RETURNING id`)
  return inserted.rows[0].id
}

async function remember(number, body, status, detail, orderId) {
  await pool.query(
    `INSERT INTO shop_inbox (shop_order_number, payload, status, detail, order_id)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     ON CONFLICT (shop_order_number) DO UPDATE
     SET payload = EXCLUDED.payload, status = EXCLUDED.status, detail = EXCLUDED.detail, order_id = EXCLUDED.order_id`,
    [number, JSON.stringify(body), status, detail, orderId],
  )
}

export async function listUnmatched() {
  const rows = await pool.query(
    `SELECT shop_order_number, detail, created_at
     FROM shop_inbox WHERE status = 'unmatched'
     ORDER BY created_at DESC
     LIMIT 50`,
  )
  return rows.rows.map((row) => ({
    shopOrderNumber: row.shop_order_number,
    detail: row.detail,
    createdAt: row.created_at,
  }))
}

export async function importShopOrder(body) {
  const shopOrderNumber = noteText(body.orderNumber || body.shopOrderNumber, 40)
  if (!shopOrderNumber) throw fail(400, "Enter the website order number")
  const existing = await pool.query(`SELECT id FROM orders WHERE shop_order_number = $1`, [shopOrderNumber])
  if (existing.rows[0]) {
    await remember(shopOrderNumber, body, "imported", "", existing.rows[0].id)
    return getOrder(existing.rows[0].id)
  }

  const items = Array.isArray(body.items) ? body.items : []
  if (!items.length) throw fail(400, "Order needs at least one item")
  const skus = [...new Set(items.map((item) => String(item.sku || "").trim().toLowerCase()).filter(Boolean))]
  const found = await pool.query(
    `SELECT p.id, p.name, p.sku, EXISTS (SELECT 1 FROM products c WHERE c.parent_id = p.id) AS has_variants
     FROM products p
     WHERE lower(p.sku) = ANY($1::text[]) AND p.sku <> ''`,
    [skus],
  )
  const bySku = new Map(found.rows.map((row) => [String(row.sku).toLowerCase(), row]))
  const problems = []
  const lines = []
  for (const item of items) {
    const sku = String(item.sku || "").trim()
    if (!sku) {
      problems.push("An item has no SKU")
      continue
    }
    const row = bySku.get(sku.toLowerCase())
    const quantity = Number(item.quantity)
    const unitPrice = money(item.unitPrice)
    if (!row) problems.push(`${sku} is not in Inventory`)
    else if (row.has_variants) problems.push(`${sku} is the product group. Put the SKU on the variant`)
    else if (!Number.isInteger(quantity) || quantity <= 0) problems.push(`${sku} needs a quantity`)
    else if (unitPrice === null) problems.push(`${sku} needs a price`)
    else lines.push({ productId: row.id, quantity, unitPrice, name: noteText(item.name, 160) || row.name })
  }
  if (problems.length) {
    const detail = problems.join(". ")
    await remember(shopOrderNumber, body, "unmatched", detail, null)
    throw fail(409, detail)
  }

  const address = [body.address, body.city, body.district].map((part) => noteText(part, 120)).filter(Boolean).join(", ")
  const deliveryCharge = money(body.deliveryCharge ?? body.shippingFee) ?? 0
  const discount = money(body.discount) ?? 0
  const sourceId = await websiteSource()
  const order = await createOrder({
    customerName: body.customerName,
    mobile: shopMobile(body.mobile || body.customerPhone),
    address,
    courier: "Steadfast",
    status: "new",
    orderedAt: new Date().toISOString(),
    deliveryCharge,
    deliveryPaidBy: deliveryCharge > 0 ? "customer" : "free",
    discount,
    paidAmount: 0,
    paymentMethod: "cod",
    note: noteText(body.note, 400),
    sourceId,
    shopOrderNumber,
    items: lines,
  })
  await remember(shopOrderNumber, body, "imported", "", order.id)
  return order
}

export async function retryShopOrder(number) {
  const shopOrderNumber = noteText(number, 40)
  const row = await pool.query(`SELECT payload FROM shop_inbox WHERE shop_order_number = $1`, [shopOrderNumber])
  if (!row.rows[0]) throw fail(404, "Website order was not found")
  return importShopOrder(row.rows[0].payload)
}
