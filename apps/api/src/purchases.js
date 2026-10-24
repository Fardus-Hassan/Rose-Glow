import { pool } from "./db.js"
import { fail, money, noteText, whole } from "./http.js"

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function dhakaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function assertDay(value) {
  const day = String(value || "")
  if (!DAY.test(day)) throw fail(400, "Enter the date")
  if (day > dhakaToday()) throw fail(400, "The date cannot be in the future")
  if (day < "2020-01-01") throw fail(400, "That date is too far back")
  return day
}

function optionalDay(value) {
  const day = String(value || "").trim()
  return day ? assertDay(day) : null
}

const IN_RANGE = `($1::date IS NULL OR bought_on >= $1::date) AND ($2::date IS NULL OR bought_on <= $2::date)`

const KINDS = new Set(["vehicle", "courier", "other"])

export async function bookTotals() {
  const [goods, kinds] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(quantity * unit_cost), 0)::float8 AS total FROM purchases`),
    pool.query(`SELECT kind, COALESCE(SUM(amount), 0)::float8 AS total FROM buying_expenses GROUP BY kind`),
  ])
  const byKind = { vehicle: 0, courier: 0, other: 0 }
  for (const row of kinds.rows) {
    if (row.kind in byKind) byKind[row.kind] = Number(row.total)
  }
  return {
    goods: Number(goods.rows[0].total),
    expenses: byKind.vehicle + byKind.courier + byKind.other,
    vehicle: byKind.vehicle,
    courier: byKind.courier,
    other: byKind.other,
  }
}

export async function listPurchases({ limit, offset, expenseLimit, expenseOffset, placeLimit, placeOffset, from, to }) {
  const start = optionalDay(from)
  const end = optionalDay(to)
  if (start && end && start > end) throw fail(400, "The start date is after the end date")
  const range = [start, end]
  const [count, rows, expenseCount, expenseRows, totals, places, placeCount, days] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(quantity), 0)::int AS pieces,
              COALESCE(SUM(quantity * unit_cost), 0)::float8 AS goods
       FROM purchases
       WHERE ${IN_RANGE}`,
      range,
    ),
    pool.query(
      `SELECT p.id, p.product_id, pr.name AS product_name, p.bought_on::text AS bought_on,
              p.quantity, p.unit_cost::float8 AS unit_cost, p.note, p.bought_from,
              (p.quantity * p.unit_cost)::float8 AS total
       FROM purchases p
       JOIN products pr ON pr.id = p.product_id
       WHERE ($1::date IS NULL OR p.bought_on >= $1::date)
         AND ($2::date IS NULL OR p.bought_on <= $2::date)
       ORDER BY p.bought_on DESC, p.id DESC
       LIMIT $3 OFFSET $4`,
      [start, end, limit, offset],
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM buying_expenses`),
    pool.query(
      `SELECT id, spent_on::text AS spent_on, kind, amount::float8 AS amount, note
       FROM buying_expenses
       ORDER BY spent_on DESC, id DESC
       LIMIT $1 OFFSET $2`,
      [expenseLimit, expenseOffset],
    ),
    bookTotals(),
    pool.query(
      `SELECT bought_from AS place, COUNT(*)::int AS lines, COALESCE(SUM(quantity * unit_cost), 0)::float8 AS total
       FROM purchases
       WHERE bought_from <> '' AND ${IN_RANGE}
       GROUP BY bought_from
       ORDER BY total DESC, place
       LIMIT $3 OFFSET $4`,
      [start, end, placeLimit, placeOffset],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT bought_from FROM purchases
         WHERE bought_from <> '' AND ${IN_RANGE}
         GROUP BY bought_from
       ) places`,
      range,
    ),
    pool.query(
      `SELECT day::text AS day,
              COALESCE(SUM(pieces), 0)::int AS pieces,
              COALESCE(SUM(goods), 0)::float8 AS goods,
              COALESCE(SUM(expenses), 0)::float8 AS expenses
       FROM (
         SELECT bought_on AS day, SUM(quantity) AS pieces, SUM(quantity * unit_cost) AS goods, 0::numeric AS expenses
         FROM purchases
         WHERE ${IN_RANGE}
         GROUP BY bought_on
         UNION ALL
         SELECT spent_on, 0, 0, SUM(amount)
         FROM buying_expenses
         WHERE ($1::date IS NULL OR spent_on >= $1::date)
           AND ($2::date IS NULL OR spent_on <= $2::date)
         GROUP BY spent_on
       ) days
       GROUP BY day
       ORDER BY day DESC
       LIMIT 400`,
      range,
    ),
  ])
  return {
    purchases: rows.rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      boughtOn: row.bought_on,
      quantity: row.quantity,
      unitCost: Number(row.unit_cost),
      note: row.note,
      boughtFrom: row.bought_from || "",
      total: Number(row.total),
    })),
    total: count.rows[0].total,
    match: {
      from: start,
      to: end,
      lines: count.rows[0].total,
      pieces: count.rows[0].pieces,
      goods: Number(count.rows[0].goods),
    },
    expenses: expenseRows.rows.map((row) => ({
      id: row.id,
      spentOn: row.spent_on,
      kind: row.kind,
      amount: Number(row.amount),
      note: row.note,
    })),
    expenseTotal: expenseCount.rows[0].total,
    goods: totals.goods,
    expensesTotal: totals.expenses,
    broughtIn: totals.goods + totals.expenses,
    days: days.rows.map((row) => ({
      day: row.day,
      pieces: row.pieces,
      goods: Number(row.goods),
      expenses: Number(row.expenses),
      total: Number(row.goods) + Number(row.expenses),
    })),
    places: places.rows.map((row) => ({
      place: row.place,
      lines: row.lines,
      total: Number(row.total),
    })),
    placeTotal: placeCount.rows[0].total,
  }
}

function purchaseFields(body) {
  const productId = whole(body.productId)
  const quantity = whole(body.quantity)
  const unitCost = money(body.unitCost)
  const boughtOn = assertDay(body.boughtOn)
  const note = noteText(body.note, 160)
  const boughtFrom = noteText(body.boughtFrom, 80)
  if (!productId || productId <= 0) throw fail(400, "Choose a product")
  if (!quantity || quantity <= 0 || quantity > 100000) throw fail(400, "Enter how many pieces you bought")
  if (unitCost === null) throw fail(400, "Enter the cost of one piece")
  return { productId, quantity, unitCost, boughtOn, note, boughtFrom }
}

function expenseFields(body) {
  const kind = String(body.kind || "")
  const amount = money(body.amount)
  const spentOn = assertDay(body.spentOn)
  const note = noteText(body.note, 160)
  if (!KINDS.has(kind)) throw fail(400, "Choose vehicle, courier, or other")
  if (amount === null || amount <= 0) throw fail(400, "Enter how much you spent")
  return { kind, amount, spentOn, note }
}

async function syncCost(client, productId) {
  const latest = await client.query(
    `SELECT unit_cost FROM purchases
     WHERE product_id = $1
     ORDER BY bought_on DESC, id DESC
     LIMIT 1`,
    [productId],
  )
  if (!latest.rows[0]) return
  await client.query(`UPDATE products SET cost_price = $2 WHERE id = $1`, [productId, latest.rows[0].unit_cost])
}

const STOCK_HELD = "Those pieces are already sold. The purchase stays so the books match the stock."

export async function createPurchase(body) {
  const fields = purchaseFields(body)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const id = await writePurchase(client, { ...fields, addStock: true })
    await client.query("COMMIT")
    return { id }
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
}

export async function writePurchase(client, { productId, boughtOn, quantity, unitCost, note, boughtFrom = "", addStock }) {
  const locked = await client.query(
    `SELECT id, is_combo FROM products WHERE id = $1 FOR UPDATE`,
    [productId],
  )
  const product = locked.rows[0]
  if (!product || product.is_combo) throw fail(400, "Choose a product from inventory")
  if (addStock) {
    await client.query(
      `UPDATE products SET stock_qty = stock_qty + $2, cost_price = $3 WHERE id = $1`,
      [productId, quantity, unitCost],
    )
  }
  const inserted = await client.query(
    `INSERT INTO purchases (product_id, bought_on, quantity, unit_cost, note, bought_from)
     VALUES ($1, $2::date, $3, $4, $5, $6)
     RETURNING id`,
    [productId, boughtOn, quantity, unitCost, note, boughtFrom],
  )
  return inserted.rows[0].id
}

export async function createExpense(body) {
  const { kind, amount, spentOn, note } = expenseFields(body)
  const inserted = await pool.query(
    `INSERT INTO buying_expenses (spent_on, kind, amount, note)
     VALUES ($1::date, $2, $3, $4)
     RETURNING id`,
    [spentOn, kind, amount, note],
  )
  return { id: inserted.rows[0].id }
}

export async function updateExpense(id, body) {
  const { kind, amount, spentOn, note } = expenseFields(body)
  const updated = await pool.query(
    `UPDATE buying_expenses
     SET spent_on = $2::date, kind = $3, amount = $4, note = $5
     WHERE id = $1
     RETURNING id`,
    [id, spentOn, kind, amount, note],
  )
  if (!updated.rows[0]) throw fail(404, "That cost was not found")
}

export async function deleteExpense(id) {
  const removed = await pool.query(`DELETE FROM buying_expenses WHERE id = $1 RETURNING id`, [id])
  if (!removed.rows[0]) throw fail(404, "That cost was not found")
}

export async function deletePurchase(id) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const found = await client.query(
      `SELECT id, product_id, quantity FROM purchases WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (!found.rows[0]) throw fail(404, "That purchase was not found")
    const updated = await client.query(
      `UPDATE products SET stock_qty = stock_qty - $2
       WHERE id = $1 AND stock_qty >= $2
       RETURNING id`,
      [found.rows[0].product_id, found.rows[0].quantity],
    )
    if (!updated.rows[0]) throw fail(400, STOCK_HELD)
    await client.query(`DELETE FROM purchases WHERE id = $1`, [id])
    await syncCost(client, found.rows[0].product_id)
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
}

export async function updatePurchase(id, body) {
  const fields = purchaseFields(body)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const found = await client.query(
      `SELECT id, product_id, quantity FROM purchases WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (!found.rows[0]) throw fail(404, "That purchase was not found")
    const old = found.rows[0]
    const productIds = [...new Set([old.product_id, fields.productId])].sort((a, b) => a - b)
    const locked = await client.query(
      `SELECT id, is_combo, stock_qty FROM products WHERE id = ANY($1::int[]) FOR UPDATE`,
      [productIds],
    )
    const products = new Map(locked.rows.map((row) => [row.id, row]))
    const next = products.get(fields.productId)
    if (!next || next.is_combo) throw fail(400, "Choose a product from inventory")
    if (old.product_id === fields.productId) {
      const delta = fields.quantity - old.quantity
      if (delta < 0) {
        const moved = await client.query(
          `UPDATE products SET stock_qty = stock_qty + $2
           WHERE id = $1 AND stock_qty + $2 >= 0
           RETURNING id`,
          [fields.productId, delta],
        )
        if (!moved.rows[0]) throw fail(400, STOCK_HELD)
      } else if (delta > 0) {
        await client.query(
          `UPDATE products SET stock_qty = stock_qty + $2 WHERE id = $1`,
          [fields.productId, delta],
        )
      }
    } else {
      const previous = products.get(old.product_id)
      if (!previous || previous.stock_qty < old.quantity) throw fail(400, STOCK_HELD)
      await client.query(`UPDATE products SET stock_qty = stock_qty - $2 WHERE id = $1`, [old.product_id, old.quantity])
      await client.query(`UPDATE products SET stock_qty = stock_qty + $2 WHERE id = $1`, [fields.productId, fields.quantity])
    }
    await client.query(
      `UPDATE purchases
       SET product_id = $2, bought_on = $3::date, quantity = $4, unit_cost = $5, note = $6, bought_from = $7
       WHERE id = $1`,
      [id, fields.productId, fields.boughtOn, fields.quantity, fields.unitCost, fields.note, fields.boughtFrom],
    )
    await syncCost(client, old.product_id)
    if (fields.productId !== old.product_id) await syncCost(client, fields.productId)
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
}
