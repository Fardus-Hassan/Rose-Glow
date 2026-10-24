import { MANUAL_STATUSES, PAYMENTS, STATUSES, holdsStock } from "@rose/shared"
import { pool } from "./db.js"
import { cleanName, fail, mobile, money, noteText, when, whole } from "./http.js"

const STATUS_IDS = new Set(STATUSES.map((item) => item.id))
const MANUAL_IDS = new Set(MANUAL_STATUSES.map((item) => item.id))

function assertHandStatus(next, current) {
  if (MANUAL_IDS.has(next) || next === current) return
  throw fail(400, "You can set New, Confirmed, or In courier. Steadfast updates the rest.")
}
const PAYMENT_IDS = new Set(PAYMENTS.map((item) => item.id))

function present(row, items = undefined) {
  const goods = Number(row.goods)
  const discount = Number(row.discount)
  const delivery = Number(row.delivery_charge)
  const paid = Number(row.paid_amount)
  const cost = Number(row.cost)
  const deliveryPaidBy = row.delivery_paid_by === "free" ? "free" : "customer"
  const deliveryOnBill = deliveryPaidBy === "customer" ? delivery : 0
  const deliveryExpense = deliveryPaidBy === "free" ? delivery : 0
  const codCharge = Number(row.cod_charge)
  const codOnBill = row.cod_paid_by === "customer" ? codCharge : 0
  const codExpense = row.cod_paid_by === "customer" ? 0 : codCharge
  const total = goods - discount + deliveryOnBill + codOnBill
  return {
    id: row.id,
    number: `RG-${String(row.id).padStart(4, "0")}`,
    customerName: row.customer_name,
    mobile: row.mobile,
    address: row.address,
    courier: row.courier,
    status: row.status,
    orderedAt: row.ordered_at,
    deliveryCharge: delivery,
    deliveryPaidBy,
    discount,
    codCharge,
    codPaidBy: row.cod_paid_by,
    paidAmount: paid,
    paymentMethod: row.payment_method,
    note: row.note,
    sourceId: row.source_id,
    sourceName: row.source_name || "",
    stockHeld: row.stock_held,
    consignmentId: row.consignment_id ? Number(row.consignment_id) : null,
    trackingCode: row.tracking_code || "",
    trackingUrl: row.tracking_url || "",
    courierStatus: row.courier_status || "",
    courierError: row.courier_error || "",
    goods,
    cost,
    total,
    due: total - paid,
    profit: goods - discount - cost - deliveryExpense - codExpense,
    ...(items ? { items } : {}),
  }
}

const ORDER_SELECT = `
  SELECT o.id, o.customer_name, o.mobile, o.address, o.courier, o.status, o.ordered_at,
         o.delivery_charge::float8 AS delivery_charge,
         o.delivery_paid_by,
         o.discount::float8 AS discount,
         o.cod_charge::float8 AS cod_charge,
         o.cod_paid_by,
         o.paid_amount::float8 AS paid_amount,
         o.payment_method, o.note, o.source_id, MAX(src.name) AS source_name, o.stock_held,
         o.consignment_id, o.tracking_code, o.tracking_url, o.courier_status, o.courier_error,
         COALESCE(SUM(oi.unit_price * oi.quantity), 0)::float8 AS goods,
         COALESCE(SUM(oi.unit_cost * oi.quantity), 0)::float8 AS cost
  FROM orders o
  LEFT JOIN order_items oi ON oi.order_id = o.id
  LEFT JOIN order_sources src ON src.id = o.source_id
`

async function itemsFor(client, orderId) {
  const result = await client.query(
    `SELECT id, product_id, product_name, quantity, unit_price::float8 AS unit_price, unit_cost::float8 AS unit_cost
     FROM order_items
     WHERE order_id = $1
     ORDER BY id`,
    [orderId],
  )
  return result.rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    name: row.product_name,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    unitCost: Number(row.unit_cost),
  }))
}

export async function getOrder(id) {
  const result = await pool.query(`${ORDER_SELECT} WHERE o.id = $1 GROUP BY o.id`, [id])
  if (!result.rows[0]) throw fail(404, "Order was not found")
  const items = await itemsFor(pool, id)
  return present(result.rows[0], items)
}

function readSourceId(body) {
  if (body.sourceId === null || body.sourceId === undefined || body.sourceId === "") return null
  const sourceId = whole(body.sourceId)
  if (!sourceId || sourceId <= 0) throw fail(400, "Source is not valid")
  return sourceId
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

const COURIER_STATUS_ID = /^[a-z0-9_]{1,80}$/

export async function listOrders({ status, q, source, from, to, limit, offset }) {
  const params = []
  const where = []
  if (source && source !== "all") {
    if (source === "none") where.push("o.source_id IS NULL")
    else {
      const sourceId = whole(source)
      if (!sourceId) throw fail(400, "Source is not valid")
      params.push(sourceId)
      where.push(`o.source_id = $${params.length}`)
    }
  }
  const hasFrom = Boolean(from)
  const hasTo = Boolean(to)
  if (hasFrom !== hasTo || (hasFrom && (!DAY.test(from) || !DAY.test(to) || from > to))) {
    throw fail(400, "The date is not valid")
  }
  if (hasFrom) {
    params.push(from, to)
    where.push(`(o.ordered_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`)
  }
  const term = String(q ?? "").trim()
  if (term) {
    const escaped = term.replace(/[\\%_]/g, "\\$&")
    params.push(`%${escaped}%`)
    const like = `$${params.length}`
    params.push(term.replace(/^RG-0*/i, ""))
    const exact = `$${params.length}`
    where.push(`(o.customer_name ILIKE ${like} ESCAPE '\\' OR o.mobile ILIKE ${like} ESCAPE '\\' OR CAST(o.id AS TEXT) = ${exact})`)
  }
  const sharedParams = [...params]
  const sharedWhere = [...where]
  if (status && status !== "all") {
    if (String(status).startsWith("sf:")) {
      const courierStatus = String(status).slice(3)
      if (!COURIER_STATUS_ID.test(courierStatus)) throw fail(400, "Status is not valid")
      params.push(courierStatus)
      where.push(`o.courier_status = $${params.length}`)
    } else {
      if (!STATUS_IDS.has(status)) throw fail(400, "Status is not valid")
      params.push(status)
      where.push(`o.status = $${params.length}`)
    }
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const facetWhere = [...sharedWhere, "o.courier_status IS NOT NULL", "o.courier_status <> ''"]
  const facets = await pool.query(
    `SELECT o.courier_status AS id, COUNT(*)::int AS count
     FROM orders o
     WHERE ${facetWhere.join(" AND ")}
     GROUP BY o.courier_status
     ORDER BY count DESC, o.courier_status`,
    sharedParams,
  )
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM orders o ${clause}`, params)
  params.push(limit, offset)
  const rows = await pool.query(
    `${ORDER_SELECT} ${clause} GROUP BY o.id ORDER BY o.ordered_at DESC, o.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return {
    orders: rows.rows.map((row) => present(row)),
    total: count.rows[0].total,
    courierFilters: facets.rows,
  }
}

async function catalogMaps(client) {
  const products = await client.query(`
    SELECT id, name, cost_price::float8 AS cost_price, sell_price::float8 AS sell_price, stock_qty, is_combo
    FROM products
  `)
  const links = await client.query(`SELECT combo_id, product_id, quantity FROM combo_items`)
  const byId = new Map(products.rows.map((row) => [row.id, row]))
  const parts = new Map()
  for (const link of links.rows) {
    const list = parts.get(link.combo_id) || []
    list.push({ productId: link.product_id, quantity: link.quantity })
    parts.set(link.combo_id, list)
  }
  return { byId, parts }
}

function readOrderFields(body, { partial = false } = {}) {
  const customerName = cleanName(body.customerName)
  const phone = mobile(body.mobile)
  const address = noteText(body.address, 300)
  const courier = noteText(body.courier, 40)
  const status = body.status || "new"
  const orderedAt = when(body.orderedAt)
  const deliveryCharge = money(body.deliveryCharge)
  const deliveryPaidBy = body.deliveryPaidBy === "free" ? "free" : "customer"
  const discount = money(body.discount)
  const paidAmount = money(body.paidAmount)
  const paymentMethod = body.paymentMethod || "cod"
  const codPaidBy = body.codPaidBy === "customer" ? "customer" : "free"
  const codCharge = money(body.codCharge)
  const note = noteText(body.note, 400)
  const sourceId = readSourceId(body)
  if (!customerName) throw fail(400, "Enter the customer's name")
  if (!phone) throw fail(400, "Enter an 11-digit mobile number starting with 01")
  if (address.length < 3) throw fail(400, "Enter the address")
  if (courier.length < 2) throw fail(400, "Choose a courier")
  if (!STATUS_IDS.has(status)) throw fail(400, "Status is not valid")
  if (!orderedAt) throw fail(400, "Enter the order time")
  if (deliveryCharge === null || discount === null || paidAmount === null || codCharge === null) throw fail(400, "Enter valid amounts")
  if (!PAYMENT_IDS.has(paymentMethod)) throw fail(400, "Payment method is not valid")
  if (deliveryPaidBy === "customer" && deliveryCharge <= 0) throw fail(400, "Enter the delivery charge")
  const fields = { customerName, phone, address, courier, status, orderedAt, deliveryCharge, deliveryPaidBy, discount, paidAmount, paymentMethod, note, codCharge, codPaidBy, sourceId }
  if (partial) return fields
  return fields
}

function linesFrom(merged, byId, parts) {
  const lines = []
  const needs = new Map()
  for (const [productId, quantity] of merged) {
    const product = byId.get(productId)
    if (!product) throw fail(400, "Product was not found")
    if (quantity <= 0 || quantity > 999) throw fail(400, "Enter a valid quantity")
    let unitCost = 0
    const recipe = product.is_combo ? parts.get(product.id) || [] : [{ productId: product.id, quantity: 1 }]
    if (product.is_combo && recipe.length === 0) throw fail(400, "This combo has no products")
    for (const part of recipe) {
      const piece = byId.get(part.productId)
      if (!piece || piece.is_combo) throw fail(400, "A product in the combo was not found")
      unitCost += Number(piece.cost_price) * part.quantity
      needs.set(part.productId, (needs.get(part.productId) || 0) + part.quantity * quantity)
    }
    lines.push({
      productId: product.id,
      productName: product.name,
      quantity,
      unitPrice: Number(product.sell_price),
      unitCost,
    })
  }
  return { lines, needs }
}

async function applyNeeds(client, needs, hold) {
  const ids = [...needs.keys()].sort((a, b) => a - b)
  if (!ids.length) return
  const locked = await client.query(
    `SELECT id, name, stock_qty FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`,
    [ids],
  )
  const stock = new Map(locked.rows.map((row) => [row.id, row]))
  if (hold) {
    for (const [productId, quantity] of needs) {
      const row = stock.get(productId)
      if (!row) throw fail(400, "A stocked product was not found")
      if (row.stock_qty < quantity) {
        throw fail(400, `${row.name} does not have enough stock. Available ${row.stock_qty}, need ${quantity}.`)
      }
    }
    for (const [productId, quantity] of needs) {
      await client.query(`UPDATE products SET stock_qty = stock_qty - $2 WHERE id = $1`, [productId, quantity])
    }
  }
}

async function moveSavedStock(client, orderId, direction) {
  const saved = await client.query(
    `SELECT product_id, quantity FROM order_stock WHERE order_id = $1 ORDER BY product_id`,
    [orderId],
  )
  const ids = saved.rows.map((row) => row.product_id)
  if (!ids.length) return
  const locked = await client.query(
    `SELECT id, name, stock_qty FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`,
    [ids],
  )
  const stock = new Map(locked.rows.map((row) => [row.id, row]))
  if (direction < 0) {
    for (const row of saved.rows) {
      const product = stock.get(row.product_id)
      if (!product) throw fail(400, "A stocked product no longer exists")
      if (product.stock_qty < row.quantity) {
        throw fail(400, `${product.name} does not have enough stock. Available ${product.stock_qty}, need ${row.quantity}.`)
      }
    }
  }
  for (const row of saved.rows) {
    await client.query(`UPDATE products SET stock_qty = stock_qty + $2 WHERE id = $1`, [row.product_id, row.quantity * direction])
  }
}

function cents(value) {
  return Math.round(Number(value) * 100)
}

function assertBill(goods, fields) {
  if (cents(fields.discount) > cents(goods)) throw fail(400, "Discount is higher than the item total")
  const deliveryOnBill = fields.deliveryPaidBy === "customer" ? fields.deliveryCharge : 0
  const codOnBill = fields.codPaidBy === "customer" ? fields.codCharge : 0
  const total = goods - fields.discount + deliveryOnBill + codOnBill
  if (cents(fields.paidAmount) > cents(total)) throw fail(400, "Paid amount is higher than the total")
}

async function assertSource(client, sourceId, required) {
  if (!sourceId) {
    if (required) throw fail(400, "Choose the order source")
    return
  }
  const found = await client.query(`SELECT id FROM order_sources WHERE id = $1`, [sourceId])
  if (!found.rows[0]) throw fail(400, "Source was not found")
}

async function assertBookedUnchanged(client, id, row, fields, replacing, body) {
  const sent = row.customer_name !== fields.customerName
    || row.mobile !== fields.phone
    || row.address !== fields.address
    || row.courier !== fields.courier
    || (row.note || "") !== fields.note
    || cents(row.delivery_charge) !== cents(fields.deliveryCharge)
    || (row.delivery_paid_by === "free" ? "free" : "customer") !== fields.deliveryPaidBy
    || cents(row.discount) !== cents(fields.discount)
    || cents(row.paid_amount) !== cents(fields.paidAmount)
    || cents(row.cod_charge) !== cents(fields.codCharge)
    || (row.cod_paid_by === "customer" ? "customer" : "free") !== fields.codPaidBy
  if (sent) throw fail(400, "This parcel is already booked with Steadfast. Name, phone, address, items, and amounts can no longer be changed.")
  if (!replacing) return
  const saved = await client.query(
    `SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id`,
    [id],
  )
  const next = [...mergedItems(body).entries()].sort((a, b) => a[0] - b[0])
  const same = saved.rows.length === next.length && saved.rows.every((item, index) => item.product_id === next[index][0] && item.quantity === next[index][1])
  if (!same) throw fail(400, "This parcel is already booked with Steadfast. Name, phone, address, items, and amounts can no longer be changed.")
}

function mergedItems(body) {
  if (!Array.isArray(body.items) || body.items.length === 0) throw fail(400, "Add at least one product")
  if (body.items.length > 30) throw fail(400, "An order cannot have more than 30 lines")
  const merged = new Map()
  for (const item of body.items) {
    const productId = whole(item.productId)
    const quantity = whole(item.quantity)
    if (!productId || !quantity || quantity <= 0) throw fail(400, "Enter a valid quantity")
    merged.set(productId, (merged.get(productId) || 0) + quantity)
  }
  return merged
}

export async function createOrder(body) {
  const fields = readOrderFields(body)
  assertHandStatus(fields.status)
  const merged = mergedItems(body)
  const client = await pool.connect()
  let orderId
  try {
    await client.query("BEGIN")
    const { byId, parts } = await catalogMaps(client)
    const { lines, needs } = linesFrom(merged, byId, parts)
    const goods = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
    assertBill(goods, fields)
    await assertSource(client, fields.sourceId, true)
    const hold = holdsStock(fields.status)
    const lockIds = [...new Set([...merged.keys(), ...needs.keys()])].sort((a, b) => a - b)
    await client.query(`SELECT id FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`, [lockIds])
    const fresh = await catalogMaps(client)
    const built = linesFrom(merged, fresh.byId, fresh.parts)
    await applyNeeds(client, built.needs, hold)
    const inserted = await client.query(
      `INSERT INTO orders
        (customer_name, mobile, address, courier, status, ordered_at, delivery_charge, delivery_paid_by, discount, paid_amount, payment_method, note, stock_held, cod_charge, cod_paid_by, source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        fields.customerName,
        fields.phone,
        fields.address,
        fields.courier,
        fields.status,
        fields.orderedAt,
        fields.deliveryCharge,
        fields.deliveryPaidBy,
        fields.discount,
        fields.paidAmount,
        fields.paymentMethod,
        fields.note,
        hold,
        fields.codCharge,
        fields.codPaidBy,
        fields.sourceId,
      ],
    )
    orderId = inserted.rows[0].id
    for (const line of built.lines) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [orderId, line.productId, line.productName, line.quantity, line.unitPrice, line.unitCost],
      )
    }
    for (const [productId, quantity] of built.needs) {
      await client.query(
        `INSERT INTO order_stock (order_id, product_id, quantity) VALUES ($1,$2,$3)`,
        [orderId, productId, quantity],
      )
    }
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
  return getOrder(orderId)
}

async function buildReplacement(client, id, body) {
  await client.query(`SELECT id FROM products ORDER BY id FOR UPDATE`)
  const fresh = await catalogMaps(client)
  const built = linesFrom(mergedItems(body), fresh.byId, fresh.parts)
  const previous = await client.query(
    `SELECT product_id, unit_price::float8 AS unit_price, unit_cost::float8 AS unit_cost
     FROM order_items WHERE order_id = $1`,
    [id],
  )
  const oldPrice = new Map(previous.rows.map((row) => [row.product_id, row]))
  for (const line of built.lines) {
    const old = oldPrice.get(line.productId)
    if (!old) continue
    line.unitPrice = Number(old.unit_price)
    line.unitCost = Number(old.unit_cost)
  }
  const goods = built.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  return { built, goods }
}

async function writeLines(client, id, built, hold, held) {
  if (held) await moveSavedStock(client, id, 1)
  await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id])
  await client.query(`DELETE FROM order_stock WHERE order_id = $1`, [id])
  await applyNeeds(client, built.needs, hold)
  for (const line of built.lines) {
    await client.query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, line.productId, line.productName, line.quantity, line.unitPrice, line.unitCost],
    )
  }
  for (const [productId, quantity] of built.needs) {
    await client.query(
      `INSERT INTO order_stock (order_id, product_id, quantity) VALUES ($1,$2,$3)`,
      [id, productId, quantity],
    )
  }
}

export async function updateOrder(id, body) {
  const fields = readOrderFields(body)
  const replacing = Array.isArray(body.items)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const current = await client.query(
      `SELECT id, status, stock_held, consignment_id, customer_name, mobile, address, courier, note,
              delivery_charge::float8 AS delivery_charge, delivery_paid_by,
              discount::float8 AS discount, paid_amount::float8 AS paid_amount,
              cod_charge::float8 AS cod_charge, cod_paid_by
       FROM orders WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (!current.rows[0]) throw fail(404, "Order was not found")
    assertHandStatus(fields.status, current.rows[0].status)
    if (current.rows[0].consignment_id) await assertBookedUnchanged(client, id, current.rows[0], fields, replacing, body)
    const held = current.rows[0].stock_held
    const hold = holdsStock(fields.status)
    let goods
    let built = null
    if (replacing) {
      const next = await buildReplacement(client, id, body)
      built = next.built
      goods = next.goods
    } else {
      const goodsResult = await client.query(
        `SELECT COALESCE(SUM(unit_price * quantity), 0)::float8 AS goods FROM order_items WHERE order_id = $1`,
        [id],
      )
      goods = Number(goodsResult.rows[0].goods)
    }
    assertBill(goods, fields)
    await assertSource(client, fields.sourceId, false)
    if (built) await writeLines(client, id, built, hold, held)
    else {
      if (hold && !held) await moveSavedStock(client, id, -1)
      if (!hold && held) await moveSavedStock(client, id, 1)
    }
    await client.query(
      `UPDATE orders SET
        customer_name = $2, mobile = $3, address = $4, courier = $5, status = $6, ordered_at = $7,
        delivery_charge = $8, delivery_paid_by = $9, discount = $10, paid_amount = $11, payment_method = $12, note = $13, stock_held = $14,
        cod_charge = $15, cod_paid_by = $16, source_id = $17
       WHERE id = $1`,
      [
        id,
        fields.customerName,
        fields.phone,
        fields.address,
        fields.courier,
        fields.status,
        fields.orderedAt,
        fields.deliveryCharge,
        fields.deliveryPaidBy,
        fields.discount,
        fields.paidAmount,
        fields.paymentMethod,
        fields.note,
        hold,
        fields.codCharge,
        fields.codPaidBy,
        fields.sourceId,
      ],
    )
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
  return getOrder(id)
}

export async function setOrderStatus(id, status, allowedFrom) {
  if (!STATUS_IDS.has(status)) throw fail(400, "Status is not valid")
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const current = await client.query(`SELECT id, status, stock_held FROM orders WHERE id = $1 FOR UPDATE`, [id])
    if (!current.rows[0]) throw fail(404, "Order was not found")
    const row = current.rows[0]
    if (row.status === status || (allowedFrom && !allowedFrom.includes(row.status))) {
      await client.query("COMMIT")
      return false
    }
    const hold = holdsStock(status)
    if (hold && !row.stock_held) await moveSavedStock(client, id, -1)
    if (!hold && row.stock_held) await moveSavedStock(client, id, 1)
    await client.query(`UPDATE orders SET status = $2, stock_held = $3 WHERE id = $1`, [id, status, hold])
    await client.query("COMMIT")
    return true
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
}

export async function deleteOrder(id) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const current = await client.query(`SELECT id, stock_held FROM orders WHERE id = $1 FOR UPDATE`, [id])
    if (!current.rows[0]) throw fail(404, "Order was not found")
    if (current.rows[0].stock_held) await moveSavedStock(client, id, 1)
    await client.query(`DELETE FROM orders WHERE id = $1`, [id])
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
}
