import { STATUSES } from "@rose/shared"
import { pool } from "./db.js"
import { inventorySummary } from "./catalog.js"
import { fail } from "./http.js"
import { bookTotals } from "./purchases.js"

const SUMMARY_SQL = `
  SELECT
    COUNT(*)::int AS orders,
    COALESCE(SUM(goods - discount), 0)::float8 AS sales,
    COALESCE(SUM(CASE WHEN delivery_paid_by = 'customer' THEN delivery_charge ELSE 0 END), 0)::float8 AS delivery,
    COALESCE(SUM(discount), 0)::float8 AS discount,
    COALESCE(SUM(cost), 0)::float8 AS cost,
    COALESCE(SUM(gifts), 0)::float8 AS gifts,
    COALESCE(SUM(paid_amount), 0)::float8 AS paid,
    COALESCE(SUM(CASE WHEN delivery_paid_by = 'free' THEN delivery_charge ELSE 0 END), 0)::float8 AS delivery_expense,
    COALESCE(SUM(CASE WHEN cod_paid_by = 'free' THEN cod_charge ELSE 0 END), 0)::float8 AS cod_expense,
    COALESCE(SUM(GREATEST(goods - discount + CASE WHEN delivery_paid_by = 'customer' THEN delivery_charge ELSE 0 END + CASE WHEN cod_paid_by = 'customer' THEN cod_charge ELSE 0 END - paid_amount, 0)), 0)::float8 AS due
  FROM (
    SELECT o.delivery_charge, o.delivery_paid_by, o.discount, o.paid_amount, o.cod_charge, o.cod_paid_by,
           COALESCE(SUM(oi.unit_price * oi.quantity), 0) AS goods,
           COALESCE(SUM(oi.unit_cost * oi.quantity), 0) AS cost,
           COALESCE(SUM(CASE WHEN oi.is_gift THEN oi.unit_cost * oi.quantity ELSE 0 END), 0) AS gifts
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status NOT IN ('cancelled', 'returned')
      AND __RANGE__
    GROUP BY o.id
  ) t
`

function rangeSql(range) {
  if (range === "today") {
    return "(o.ordered_at AT TIME ZONE 'Asia/Dhaka')::date = (now() AT TIME ZONE 'Asia/Dhaka')::date"
  }
  if (range === "month") {
    return "date_trunc('month', o.ordered_at AT TIME ZONE 'Asia/Dhaka') = date_trunc('month', now() AT TIME ZONE 'Asia/Dhaka')"
  }
  return "TRUE"
}

export async function orderTotals() {
  return summarize("all")
}

async function summarize(range) {
  const result = await pool.query(SUMMARY_SQL.replace("__RANGE__", rangeSql(range)))
  const row = result.rows[0]
  return {
    orders: row.orders,
    sales: Number(row.sales),
    delivery: Number(row.delivery),
    discount: Number(row.discount),
    cost: Number(row.cost),
    gifts: Number(row.gifts),
    paid: Number(row.paid),
    due: Number(row.due),
    profit: Number(row.sales) - Number(row.cost) - Number(row.delivery_expense) - Number(row.cod_expense),
  }
}

export async function dashboard() {
  const [today, month, allDue, statusRows, monthStatusRows, inventory, recent, booksMoney] = await Promise.all([
    summarize("today"),
    summarize("month"),
    summarize("all"),
    pool.query(`SELECT status, COUNT(*)::int AS count FROM orders WHERE status IN ('new','confirmed','courier') GROUP BY status`),
    pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM orders
      WHERE date_trunc('month', ordered_at AT TIME ZONE 'Asia/Dhaka') = date_trunc('month', now() AT TIME ZONE 'Asia/Dhaka')
      GROUP BY status
    `),
    inventorySummary(),
    pool.query(`
      SELECT o.id, o.customer_name, o.mobile, o.courier, o.status, o.ordered_at,
             o.paid_amount::float8 AS paid_amount,
             MAX(src.name) AS source_name,
             (COALESCE(SUM(oi.unit_price * oi.quantity), 0) - o.discount + CASE WHEN o.delivery_paid_by = 'customer' THEN o.delivery_charge ELSE 0 END + CASE WHEN o.cod_paid_by = 'customer' THEN o.cod_charge ELSE 0 END)::float8 AS total
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN order_sources src ON src.id = o.source_id
      GROUP BY o.id
      ORDER BY o.ordered_at DESC, o.id DESC
      LIMIT 10
    `),
    bookTotals(),
  ])
  const open = Object.fromEntries(STATUSES.filter((item) => ["new", "confirmed", "courier"].includes(item.id)).map((item) => [item.id, 0]))
  for (const row of statusRows.rows) open[row.status] = row.count
  const monthStatuses = Object.fromEntries(STATUSES.map((item) => [item.id, 0]))
  for (const row of monthStatusRows.rows) monthStatuses[row.status] = row.count
  return {
    today,
    month,
    dueAll: allDue.due,
    books: {
      goods: booksMoney.goods,
      expenses: booksMoney.expenses,
      vehicle: booksMoney.vehicle,
      courier: booksMoney.courier,
      other: booksMoney.other,
      broughtIn: booksMoney.goods + booksMoney.expenses,
      sales: allDue.sales,
      profit: allDue.profit - booksMoney.expenses,
    },
    open,
    monthStatuses,
    inventory,
    recent: recent.rows.map((row) => ({
      id: row.id,
      number: `RG-${String(row.id).padStart(4, "0")}`,
      customerName: row.customer_name,
      mobile: row.mobile,
      courier: row.courier,
      sourceName: row.source_name || "",
      status: row.status,
      orderedAt: row.ordered_at,
      total: Number(row.total),
      due: Number(row.total) - Number(row.paid_amount),
    })),
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

function daySpan(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / 86400000) + 1
}

export async function rangeStats(from, to) {
  if (!DAY.test(String(from || "")) || !DAY.test(String(to || "")) || from > to) throw fail(400, "The date is not valid")
  if (daySpan(from, to) > 800) throw fail(400, "Keep the date range within 800 days")
  const countable = `o.status NOT IN ('cancelled', 'returned') AND (o.ordered_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1::date AND $2::date`
  const [pointRows, sourceRows, statusRows, courierRows] = await Promise.all([
    pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS date, COUNT(*)::int AS orders, COALESCE(SUM(goods - discount), 0)::float8 AS amount
       FROM (
         SELECT (o.ordered_at AT TIME ZONE 'Asia/Dhaka')::date AS day, o.discount,
                COALESCE(SUM(oi.unit_price * oi.quantity), 0) AS goods
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         WHERE ${countable}
         GROUP BY o.id
       ) t
       GROUP BY day
       ORDER BY day`,
      [from, to],
    ),
    pool.query(
      `SELECT source_id, name, COUNT(*)::int AS orders, COALESCE(SUM(goods - discount), 0)::float8 AS amount
       FROM (
         SELECT o.source_id, COALESCE(src.name, 'Not set') AS name, o.discount,
                COALESCE(SUM(oi.unit_price * oi.quantity), 0) AS goods
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN order_sources src ON src.id = o.source_id
         WHERE ${countable}
         GROUP BY o.id, src.name
       ) t
       GROUP BY source_id, name
       ORDER BY orders DESC, name`,
      [from, to],
    ),
    pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM orders o
       WHERE (o.ordered_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1::date AND $2::date
       GROUP BY status`,
      [from, to],
    ),
    pool.query(
      `SELECT to_char((courier_sent_at AT TIME ZONE 'Asia/Dhaka')::date, 'YYYY-MM-DD') AS date, COUNT(*)::int AS courier
       FROM orders
       WHERE courier_sent_at IS NOT NULL
         AND (courier_sent_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1::date AND $2::date
       GROUP BY 1
       ORDER BY 1`,
      [from, to],
    ),
  ])
  const byDate = new Map(pointRows.rows.map((row) => [row.date, { date: row.date, orders: row.orders, amount: Number(row.amount), courier: 0 }]))
  for (const row of courierRows.rows) {
    const point = byDate.get(row.date) || { date: row.date, orders: 0, amount: 0, courier: 0 }
    point.courier = row.courier
    byDate.set(row.date, point)
  }
  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const statuses = Object.fromEntries(STATUSES.map((item) => [item.id, 0]))
  for (const row of statusRows.rows) statuses[row.status] = row.count
  return {
    from,
    to,
    orders: points.reduce((sum, point) => sum + point.orders, 0),
    amount: points.reduce((sum, point) => sum + point.amount, 0),
    courier: points.reduce((sum, point) => sum + point.courier, 0),
    points,
    sources: sourceRows.rows.map((row) => ({
      id: row.source_id,
      name: row.name,
      orders: row.orders,
      amount: Number(row.amount),
    })),
    statuses,
  }
}
