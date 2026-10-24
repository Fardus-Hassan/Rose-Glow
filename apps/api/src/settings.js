import { COURIER_STATUSES } from "@rose/shared"
import { pool } from "./db.js"
import { fail } from "./http.js"

const FILTER_KEY = "steadfast_filter_hidden"
const STATUS_ID = /^[a-z0-9_]{1,80}$/

function cleanIds(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id) => typeof id === "string" && STATUS_ID.test(id)))]
}

export async function hiddenCourierStatuses() {
  const result = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [FILTER_KEY])
  return cleanIds(result.rows[0]?.value)
}

export async function courierFilterView() {
  const hidden = await hiddenCourierStatuses()
  const found = await pool.query(
    `SELECT DISTINCT courier_status AS id
     FROM orders
     WHERE courier_status IS NOT NULL AND courier_status <> ''
     ORDER BY id`,
  )
  const known = new Set(Object.keys(COURIER_STATUSES))
  const extra = [...new Set([...found.rows.map((row) => row.id), ...hidden])]
    .filter((id) => typeof id === "string" && !known.has(id) && STATUS_ID.test(id))
  return { hidden, extra }
}

export async function saveCourierFilters(body) {
  if (!Array.isArray(body?.hidden)) throw fail(400, "Choose which statuses to show")
  const hidden = cleanIds(body.hidden).slice(0, 80)
  await pool.query(
    `INSERT INTO app_settings (key, value)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [FILTER_KEY, JSON.stringify(hidden)],
  )
  return courierFilterView()
}
