import { PAYMENTS, STATUSES, holdsStock } from "@rose/shared"
import { pool } from "./db.js"
import { cleanName, fail, mobile, money, noteText, when, whole } from "./http.js"

const STATUS_IDS = new Set(STATUSES.map((item) => item.id))
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
  if (!result.rows[0]) throw fail(404, "অর্ডার পাওয়া যায়নি")
  const items = await itemsFor(pool, id)
  return present(result.rows[0], items)
}

function readSourceId(body) {
  if (body.sourceId === null || body.sourceId === undefined || body.sourceId === "") return null
  const sourceId = whole(body.sourceId)
  if (!sourceId || sourceId <= 0) throw fail(400, "সোর্স ঠিক নেই")
  return sourceId
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

export async function listOrders({ status, q, source, from, to, limit, offset }) {
  const params = []
  const where = []
  if (status && status !== "all") {
    if (!STATUS_IDS.has(status)) throw fail(400, "স্ট্যাটাস ঠিক নেই")
    params.push(status)
    where.push(`o.status = $${params.length}`)
  }
  if (source && source !== "all") {
    if (source === "none") where.push("o.source_id IS NULL")
    else {
      const sourceId = whole(source)
      if (!sourceId) throw fail(400, "সোর্স ঠিক নেই")
      params.push(sourceId)
      where.push(`o.source_id = $${params.length}`)
    }
  }
  const hasFrom = Boolean(from)
  const hasTo = Boolean(to)
  if (hasFrom !== hasTo || (hasFrom && (!DAY.test(from) || !DAY.test(to) || from > to))) {
    throw fail(400, "তারিখ ঠিক নেই")
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
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM orders o ${clause}`, params)
  params.push(limit, offset)
  const rows = await pool.query(
    `${ORDER_SELECT} ${clause} GROUP BY o.id ORDER BY o.ordered_at DESC, o.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return { orders: rows.rows.map((row) => present(row)), total: count.rows[0].total }
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
  if (!customerName) throw fail(400, "কাস্টমারের নাম দিন")
  if (!phone) throw fail(400, "মোবাইল নম্বর 01 দিয়ে ১১ সংখ্যা দিন")
  if (address.length < 3) throw fail(400, "ঠিকানা দিন")
  if (courier.length < 2) throw fail(400, "কুরিয়ার দিন")
  if (!STATUS_IDS.has(status)) throw fail(400, "স্ট্যাটাস ঠিক নেই")
  if (!orderedAt) throw fail(400, "অর্ডারের সময় দিন")
  if (deliveryCharge === null || discount === null || paidAmount === null || codCharge === null) throw fail(400, "টাকার অংক ঠিকমতো দিন")
  if (!PAYMENT_IDS.has(paymentMethod)) throw fail(400, "পেমেন্টের ধরন ঠিক নেই")
  if (deliveryPaidBy === "customer" && deliveryCharge <= 0) throw fail(400, "ডেলিভারির টাকা দিন")
  const fields = { customerName, phone, address, courier, status, orderedAt, deliveryCharge, deliveryPaidBy, discount, paidAmount, paymentMethod, note, codCharge, codPaidBy, sourceId }
  if (partial) return fields
  return fields
}

function linesFrom(merged, byId, parts) {
  const lines = []
  const needs = new Map()
  for (const [productId, quantity] of merged) {
    const product = byId.get(productId)
    if (!product) throw fail(400, "পণ্য পাওয়া যায়নি")
    if (quantity <= 0 || quantity > 999) throw fail(400, "পণ্যের পিস ঠিকমতো দিন")
    let unitCost = 0
    const recipe = product.is_combo ? parts.get(product.id) || [] : [{ productId: product.id, quantity: 1 }]
    if (product.is_combo && recipe.length === 0) throw fail(400, "এই কম্বোতে কোনো পণ্য নেই")
    for (const part of recipe) {
      const piece = byId.get(part.productId)
      if (!piece || piece.is_combo) throw fail(400, "কম্বোর পণ্য পাওয়া যায়নি")
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
      if (!row) throw fail(400, "স্টকের পণ্য পাওয়া যায়নি")
      if (row.stock_qty < quantity) {
        throw fail(400, `${row.name} পর্যাপ্ত নেই। আছে ${row.stock_qty} পিস, লাগবে ${quantity} পিস।`)
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
      if (!product) throw fail(400, "স্টকের পণ্য আর নেই")
      if (product.stock_qty < row.quantity) {
        throw fail(400, `${product.name} পর্যাপ্ত নেই। আছে ${product.stock_qty} পিস, লাগবে ${row.quantity} পিস।`)
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
  if (cents(fields.discount) > cents(goods)) throw fail(400, "ডিসকাউন্ট পণ্যের দামের চেয়ে বেশি")
  const deliveryOnBill = fields.deliveryPaidBy === "customer" ? fields.deliveryCharge : 0
  const codOnBill = fields.codPaidBy === "customer" ? fields.codCharge : 0
  const total = goods - fields.discount + deliveryOnBill + codOnBill
  if (cents(fields.paidAmount) > cents(total)) throw fail(400, "জমা মোট টাকার চেয়ে বেশি")
}

async function assertSource(client, sourceId, required) {
  if (!sourceId) {
    if (required) throw fail(400, "অর্ডারের সোর্স দিন")
    return
  }
  const found = await client.query(`SELECT id FROM order_sources WHERE id = $1`, [sourceId])
  if (!found.rows[0]) throw fail(400, "সোর্স পাওয়া যায়নি")
}

function mergedItems(body) {
  if (!Array.isArray(body.items) || body.items.length === 0) throw fail(400, "অন্তত একটা পণ্য যোগ করুন")
  if (body.items.length > 30) throw fail(400, "এক অর্ডারে ৩০টার বেশি লাইন যাবে না")
  const merged = new Map()
  for (const item of body.items) {
    const productId = whole(item.productId)
    const quantity = whole(item.quantity)
    if (!productId || !quantity || quantity <= 0) throw fail(400, "পণ্যের পিস ঠিকমতো দিন")
    merged.set(productId, (merged.get(productId) || 0) + quantity)
  }
  return merged
}

export async function createOrder(body) {
  const fields = readOrderFields(body)
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
    const current = await client.query(`SELECT id, status, stock_held FROM orders WHERE id = $1 FOR UPDATE`, [id])
    if (!current.rows[0]) throw fail(404, "অর্ডার পাওয়া যায়নি")
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

export async function deleteOrder(id) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const current = await client.query(`SELECT id, stock_held FROM orders WHERE id = $1 FOR UPDATE`, [id])
    if (!current.rows[0]) throw fail(404, "অর্ডার পাওয়া যায়নি")
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
