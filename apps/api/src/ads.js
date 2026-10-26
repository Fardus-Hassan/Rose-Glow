import { pool } from "./db.js"
import { fail, money, noteText, whole } from "./http.js"
import { dhakaToday } from "./purchases.js"

const DAY = /^\d{4}-\d{2}-\d{2}$/

function adFields(body) {
  const spentOn = String(body.spentOn || "")
  if (!DAY.test(spentOn)) throw fail(400, "Enter the date")
  if (spentOn > dhakaToday()) throw fail(400, "The date cannot be in the future")
  if (spentOn < "2020-01-01") throw fail(400, "That date is too far back")
  const sourceId = whole(body.sourceId)
  if (!sourceId || sourceId <= 0) throw fail(400, "Choose the platform")
  const amount = money(body.amount)
  if (amount === null || amount <= 0) throw fail(400, "Enter how much you spent")
  return { spentOn, sourceId, amount, note: noteText(body.note, 160) }
}

function missingSource(error) {
  if (error.code === "23503") return fail(400, "Choose the platform")
  return error
}

export async function createAd(body) {
  const fields = adFields(body)
  try {
    const inserted = await pool.query(
      `INSERT INTO ad_spends (spent_on, source_id, amount, note) VALUES ($1::date, $2, $3, $4) RETURNING id`,
      [fields.spentOn, fields.sourceId, fields.amount, fields.note],
    )
    return { id: inserted.rows[0].id }
  } catch (error) {
    throw missingSource(error)
  }
}

export async function updateAd(id, body) {
  const fields = adFields(body)
  try {
    const updated = await pool.query(
      `UPDATE ad_spends SET spent_on = $2::date, source_id = $3, amount = $4, note = $5 WHERE id = $1 RETURNING id`,
      [id, fields.spentOn, fields.sourceId, fields.amount, fields.note],
    )
    if (!updated.rows[0]) throw fail(404, "That ad cost was not found")
  } catch (error) {
    throw missingSource(error)
  }
}

export async function deleteAd(id) {
  const removed = await pool.query(`DELETE FROM ad_spends WHERE id = $1 RETURNING id`, [id])
  if (!removed.rows[0]) throw fail(404, "That ad cost was not found")
}

export async function adSpendTotal() {
  const result = await pool.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM ad_spends`)
  return Number(result.rows[0].total)
}

function rate(top, bottom) {
  return bottom > 0 ? top / bottom : null
}

export async function adReport({ from, to, limit, offset }) {
  if (!DAY.test(String(from || "")) || !DAY.test(String(to || "")) || from > to) throw fail(400, "The date is not valid")
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  if (span > 800) throw fail(400, "Keep the date range within 800 days")
  const [spendRows, orderRows, entryRows, countRow, daySpendRows, dayOrderRows] = await Promise.all([
    pool.query(
      `SELECT source_id, SUM(amount)::float8 AS spend
       FROM ad_spends
       WHERE spent_on BETWEEN $1::date AND $2::date
       GROUP BY source_id`,
      [from, to],
    ),
    pool.query(
      `SELECT o.source_id, COALESCE(MAX(src.name), 'Not set') AS name,
              COUNT(*) FILTER (WHERE o.counted)::int AS orders,
              COALESCE(SUM(o.sales) FILTER (WHERE o.counted), 0)::float8 AS sales,
              COALESCE(SUM(o.profit), 0)::float8 AS profit
       FROM order_money o
       LEFT JOIN order_sources src ON src.id = o.source_id
       WHERE (o.ordered_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1::date AND $2::date
       GROUP BY o.source_id
       HAVING COUNT(*) FILTER (WHERE o.counted) > 0 OR COALESCE(SUM(o.profit), 0) <> 0`,
      [from, to],
    ),
    pool.query(
      `SELECT a.id, to_char(a.spent_on, 'YYYY-MM-DD') AS spent_on, a.source_id, src.name AS source_name,
              a.amount::float8 AS amount, a.note
       FROM ad_spends a
       JOIN order_sources src ON src.id = a.source_id
       WHERE a.spent_on BETWEEN $1::date AND $2::date
       ORDER BY a.spent_on DESC, a.id DESC
       LIMIT $3 OFFSET $4`,
      [from, to, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM ad_spends WHERE spent_on BETWEEN $1::date AND $2::date`,
      [from, to],
    ),
    pool.query(
      `SELECT to_char(spent_on, 'YYYY-MM-DD') AS date, SUM(amount)::float8 AS spend
       FROM ad_spends
       WHERE spent_on BETWEEN $1::date AND $2::date
       GROUP BY spent_on`,
      [from, to],
    ),
    pool.query(
      `SELECT to_char((o.ordered_at AT TIME ZONE 'Asia/Dhaka')::date, 'YYYY-MM-DD') AS date,
              COUNT(*) FILTER (WHERE o.counted)::int AS orders,
              COALESCE(SUM(o.sales) FILTER (WHERE o.counted), 0)::float8 AS sales,
              COALESCE(SUM(o.profit), 0)::float8 AS profit
       FROM order_money o
       WHERE (o.ordered_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1::date AND $2::date
         AND o.source_id IN (SELECT source_id FROM ad_spends WHERE spent_on BETWEEN $1::date AND $2::date)
       GROUP BY 1`,
      [from, to],
    ),
  ])
  const dayMap = new Map()
  const dayOf = (date) => dayMap.get(date) || dayMap.set(date, { date, spend: 0, orders: 0, sales: 0, profit: 0 }).get(date)
  for (const row of daySpendRows.rows) dayOf(row.date).spend = Number(row.spend)
  for (const row of dayOrderRows.rows) {
    const day = dayOf(row.date)
    day.orders = row.orders
    day.sales = Number(row.sales)
    day.profit = Number(row.profit)
  }
  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))

  const names = await pool.query(`SELECT id, name, position FROM order_sources ORDER BY position, id`)
  const platforms = new Map()
  const blank = (id, name, position) => ({ id, name, position, spend: 0, orders: 0, sales: 0, profit: 0 })
  for (const row of names.rows) platforms.set(row.id, blank(row.id, row.name, row.position))
  for (const row of orderRows.rows) {
    const key = row.source_id ?? "none"
    const item = platforms.get(key) || blank(row.source_id, row.name, 9999)
    item.orders = row.orders
    item.sales = Number(row.sales)
    item.profit = Number(row.profit)
    platforms.set(key, item)
  }
  for (const row of spendRows.rows) {
    const item = platforms.get(row.source_id)
    if (item) item.spend = Number(row.spend)
  }

  const list = [...platforms.values()]
    .filter((item) => item.spend > 0 || item.orders > 0)
    .map((item) => ({
      ...item,
      paid: item.spend > 0,
      afterAds: item.profit - item.spend,
      perOrder: item.spend > 0 && item.orders > 0 ? Math.round(item.spend / item.orders) : null,
      back: rate(item.sales, item.spend),
    }))
    .sort((a, b) => b.spend - a.spend || b.orders - a.orders || a.position - b.position)

  const paid = list.filter((item) => item.paid)
  const spend = paid.reduce((sum, item) => sum + item.spend, 0)
  const orders = paid.reduce((sum, item) => sum + item.orders, 0)
  const sales = paid.reduce((sum, item) => sum + item.sales, 0)
  const profit = paid.reduce((sum, item) => sum + item.profit, 0)

  return {
    from,
    to,
    totals: {
      spend,
      orders,
      sales,
      profit,
      afterAds: profit - spend,
      perOrder: spend > 0 && orders > 0 ? Math.round(spend / orders) : null,
      back: rate(sales, spend),
    },
    platforms: list.map(({ position, ...item }) => item),
    days,
    entries: entryRows.rows.map((row) => ({
      id: row.id,
      spentOn: row.spent_on,
      sourceId: row.source_id,
      sourceName: row.source_name,
      amount: Number(row.amount),
      note: row.note,
    })),
    entryTotal: countRow.rows[0].total,
  }
}
