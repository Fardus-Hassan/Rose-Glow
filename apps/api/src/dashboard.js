import { STATUSES } from "@rose/shared"
import { pool } from "./db.js"
import { inventorySummary } from "./catalog.js"
import { fail } from "./http.js"
import { bookTotals } from "./purchases.js"
import { adSpendTotal } from "./ads.js"

const SUMMARY_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE counted)::int AS orders,
    COALESCE(SUM(sales) FILTER (WHERE counted), 0)::float8 AS sales,
    COALESCE(SUM(bill_delivery) FILTER (WHERE counted), 0)::float8 AS delivery,
    COALESCE(SUM(discount) FILTER (WHERE counted), 0)::float8 AS discount,
    COALESCE(SUM(cost) FILTER (WHERE counted), 0)::float8 AS cost,
    COALESCE(SUM(gifts) FILTER (WHERE counted), 0)::float8 AS gifts,
    COALESCE(SUM(paid_amount) FILTER (WHERE counted), 0)::float8 AS paid,
    COALESCE(SUM(GREATEST(total - paid_amount, 0)) FILTER (WHERE counted), 0)::float8 AS due,
    COALESCE(SUM(profit), 0)::float8 AS profit
  FROM order_money o
  WHERE __RANGE__
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

function spentSql(range) {
  if (range === "today") return "spent_on = (now() AT TIME ZONE 'Asia/Dhaka')::date"
  if (range === "month") return "date_trunc('month', spent_on) = date_trunc('month', now() AT TIME ZONE 'Asia/Dhaka')"
  return "TRUE"
}

export async function orderTotals() {
  return summarize("all")
}

async function summarize(range) {
  const [result, spent] = await Promise.all([
    pool.query(SUMMARY_SQL.replace("__RANGE__", rangeSql(range))),
    pool.query(`
      SELECT (SELECT COALESCE(SUM(amount), 0) FROM ad_spends WHERE ${spentSql(range)})::float8 AS ads,
             (SELECT COALESCE(SUM(amount), 0) FROM buying_expenses WHERE kind <> 'salary' AND ${spentSql(range)})::float8 AS expenses,
             (SELECT COALESCE(SUM(amount), 0) FROM buying_expenses WHERE kind = 'salary' AND ${spentSql(range)})::float8 AS salary
    `),
  ])
  const row = result.rows[0]
  const profit = Number(row.profit)
  const ads = Number(spent.rows[0].ads)
  const expenses = Number(spent.rows[0].expenses)
  const salary = Number(spent.rows[0].salary)
  return {
    ads,
    expenses,
    salary,
    net: profit - ads - expenses - salary,
    orders: row.orders,
    sales: Number(row.sales),
    delivery: Number(row.delivery),
    discount: Number(row.discount),
    cost: Number(row.cost),
    gifts: Number(row.gifts),
    paid: Number(row.paid),
    due: Number(row.due),
    profit,
  }
}

export async function dashboard() {
  const [today, month, allDue, statusRows, monthStatusRows, inventory, booksMoney, adsAll] = await Promise.all([
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
    bookTotals(),
    adSpendTotal(),
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
      bringing: booksMoney.bringing,
      salary: booksMoney.salary,
      vehicle: booksMoney.vehicle,
      courier: booksMoney.courier,
      other: booksMoney.other,
      broughtIn: booksMoney.goods + booksMoney.bringing,
      sales: allDue.sales,
      ads: adsAll,
      profit: allDue.profit - booksMoney.expenses - adsAll,
    },
    open,
    monthStatuses,
    inventory,
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
  const countable = `o.counted AND (o.ordered_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1::date AND $2::date`
  const [pointRows, sourceRows, statusRows, courierRows] = await Promise.all([
    pool.query(
      `SELECT to_char((o.ordered_at AT TIME ZONE 'Asia/Dhaka')::date, 'YYYY-MM-DD') AS date,
              COUNT(*)::int AS orders, COALESCE(SUM(o.sales), 0)::float8 AS amount
       FROM order_money o
       WHERE ${countable}
       GROUP BY 1
       ORDER BY 1`,
      [from, to],
    ),
    pool.query(
      `SELECT o.source_id, COALESCE(MAX(src.name), 'Not set') AS name, COUNT(*)::int AS orders, COALESCE(SUM(o.sales), 0)::float8 AS amount
       FROM order_money o
       LEFT JOIN order_sources src ON src.id = o.source_id
       WHERE ${countable}
       GROUP BY o.source_id
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
