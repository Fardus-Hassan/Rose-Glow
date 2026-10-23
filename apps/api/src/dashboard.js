import { STATUSES } from "@rose/shared"
import { pool } from "./db.js"
import { inventorySummary } from "./catalog.js"

const SUMMARY_SQL = `
  SELECT
    COUNT(*)::int AS orders,
    COALESCE(SUM(goods - discount), 0)::float8 AS sales,
    COALESCE(SUM(CASE WHEN delivery_paid_by = 'customer' THEN delivery_charge ELSE 0 END), 0)::float8 AS delivery,
    COALESCE(SUM(discount), 0)::float8 AS discount,
    COALESCE(SUM(cost), 0)::float8 AS cost,
    COALESCE(SUM(paid_amount), 0)::float8 AS paid,
    COALESCE(SUM(CASE WHEN delivery_paid_by = 'free' THEN delivery_charge ELSE 0 END), 0)::float8 AS delivery_expense,
    COALESCE(SUM(CASE WHEN cod_paid_by = 'free' THEN cod_charge ELSE 0 END), 0)::float8 AS cod_expense,
    COALESCE(SUM(GREATEST(goods - discount + CASE WHEN delivery_paid_by = 'customer' THEN delivery_charge ELSE 0 END + CASE WHEN cod_paid_by = 'customer' THEN cod_charge ELSE 0 END - paid_amount, 0)), 0)::float8 AS due
  FROM (
    SELECT o.delivery_charge, o.delivery_paid_by, o.discount, o.paid_amount, o.cod_charge, o.cod_paid_by,
           COALESCE(SUM(oi.unit_price * oi.quantity), 0) AS goods,
           COALESCE(SUM(oi.unit_cost * oi.quantity), 0) AS cost
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

async function summarize(range) {
  const result = await pool.query(SUMMARY_SQL.replace("__RANGE__", rangeSql(range)))
  const row = result.rows[0]
  return {
    orders: row.orders,
    sales: Number(row.sales),
    delivery: Number(row.delivery),
    discount: Number(row.discount),
    cost: Number(row.cost),
    paid: Number(row.paid),
    due: Number(row.due),
    profit: Number(row.sales) - Number(row.cost) - Number(row.delivery_expense) - Number(row.cod_expense),
  }
}

export async function dashboard() {
  const [today, month, allDue, statusRows, monthStatusRows, inventory, recent] = await Promise.all([
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
      SELECT o.id, o.customer_name, o.status, o.ordered_at,
             (COALESCE(SUM(oi.unit_price * oi.quantity), 0) - o.discount + CASE WHEN o.delivery_paid_by = 'customer' THEN o.delivery_charge ELSE 0 END + CASE WHEN o.cod_paid_by = 'customer' THEN o.cod_charge ELSE 0 END)::float8 AS total
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      GROUP BY o.id
      ORDER BY o.ordered_at DESC, o.id DESC
      LIMIT 10
    `),
  ])
  const open = Object.fromEntries(STATUSES.filter((item) => ["new", "confirmed", "courier"].includes(item.id)).map((item) => [item.id, 0]))
  for (const row of statusRows.rows) open[row.status] = row.count
  const monthStatuses = Object.fromEntries(STATUSES.map((item) => [item.id, 0]))
  for (const row of monthStatusRows.rows) monthStatuses[row.status] = row.count
  return {
    today,
    month,
    dueAll: allDue.due,
    open,
    monthStatuses,
    inventory,
    recent: recent.rows.map((row) => ({
      id: row.id,
      number: `RG-${String(row.id).padStart(4, "0")}`,
      customerName: row.customer_name,
      status: row.status,
      orderedAt: row.ordered_at,
      total: Number(row.total),
    })),
  }
}
