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

export async function listPurchases({ limit, offset, expenseLimit, expenseOffset }) {
  const [count, rows, expenseCount, expenseRows, totals, places, days] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM purchases`),
    pool.query(
      `SELECT p.id, p.product_id, pr.name AS product_name, p.bought_on::text AS bought_on,
              p.quantity, p.unit_cost::float8 AS unit_cost, p.note, p.bought_from,
              (p.quantity * p.unit_cost)::float8 AS total
       FROM purchases p
       JOIN products pr ON pr.id = p.product_id
       ORDER BY p.bought_on DESC, p.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
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
       WHERE bought_from <> ''
       GROUP BY bought_from
       ORDER BY total DESC, place
       LIMIT 20`,
    ),
    pool.query(
      `SELECT day::text AS day,
              COALESCE(SUM(pieces), 0)::int AS pieces,
              COALESCE(SUM(goods), 0)::float8 AS goods,
              COALESCE(SUM(expenses), 0)::float8 AS expenses
       FROM (
         SELECT bought_on AS day, SUM(quantity) AS pieces, SUM(quantity * unit_cost) AS goods, 0::numeric AS expenses
         FROM purchases
         GROUP BY bought_on
         UNION ALL
         SELECT spent_on, 0, 0, SUM(amount)
         FROM buying_expenses
         GROUP BY spent_on
       ) days
       GROUP BY day
       ORDER BY day DESC
       LIMIT 400`,
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
  }
}

export async function createPurchase(body) {
  const productId = whole(body.productId)
  const quantity = whole(body.quantity)
  const unitCost = money(body.unitCost)
  const boughtOn = assertDay(body.boughtOn)
  const note = noteText(body.note, 160)
  const boughtFrom = noteText(body.boughtFrom, 80)
  if (!productId || productId <= 0) throw fail(400, "Choose a product")
  if (!quantity || quantity <= 0 || quantity > 100000) throw fail(400, "Enter how many pieces you bought")
  if (unitCost === null) throw fail(400, "Enter the cost of one piece")
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const id = await writePurchase(client, { productId, boughtOn, quantity, unitCost, note, boughtFrom, addStock: true })
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
  const kind = String(body.kind || "")
  const amount = money(body.amount)
  const spentOn = assertDay(body.spentOn)
  const note = noteText(body.note, 160)
  if (!KINDS.has(kind)) throw fail(400, "Choose vehicle, courier, or other")
  if (amount === null || amount <= 0) throw fail(400, "Enter how much you spent")
  const inserted = await pool.query(
    `INSERT INTO buying_expenses (spent_on, kind, amount, note)
     VALUES ($1::date, $2, $3, $4)
     RETURNING id`,
    [spentOn, kind, amount, note],
  )
  return { id: inserted.rows[0].id }
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
    if (!updated.rows[0]) {
      throw fail(400, "Those pieces are already sold. The purchase stays so the books match the stock.")
    }
    await client.query(`DELETE FROM purchases WHERE id = $1`, [id])
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
}
