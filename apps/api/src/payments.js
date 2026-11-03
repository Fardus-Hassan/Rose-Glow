import { keysOrNull } from "./courier.js"
import { pool } from "./db.js"
import { fail, when } from "./http.js"
import { steadfast } from "./steadfast.js"

const STATE_KEY = "steadfast_payments_sync"
const AUTO_GAP_MS = 30 * 60 * 1000
const BUDGET_MS = 40000
const MAX_PAGES = 500
const LOCK_ID = 730021

function money(value) {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) && Math.abs(n) < 1e12 ? Math.round(n * 100) / 100 : null
}

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim()
}

// Steadfast sends Bangladesh time without a zone, e.g. "2026-10-20 10:00:00".
function moment(value) {
  if (value === null || value === undefined || value === "") return null
  const raw = String(value).trim()
  const bare = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(raw)
  if (!bare) return when(raw)
  const [day, time = "00:00:00"] = raw.split(/[ T]/)
  return when(`${day}T${time.length === 5 ? `${time}:00` : time}+06:00`)
}

function listIn(data, depth = 0) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== "object" || depth > 2) return []
  for (const key of ["data", "payments", "items", "results"]) {
    if (Array.isArray(data[key])) return data[key]
  }
  for (const key of ["data", "payments", "result"]) {
    const inner = data[key]
    if (inner && typeof inner === "object") {
      const found = listIn(inner, depth + 1)
      if (found.length) return found
    }
  }
  return []
}

function lastPage(data) {
  const value = data?.last_page ?? data?.meta?.last_page ?? data?.data?.last_page ?? data?.pagination?.last_page
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

function readPayment(row) {
  if (!row || typeof row !== "object") return null
  const ref = text(row.id ?? row.payment_id)
  if (!ref) return null
  return {
    ref,
    label: text(row.payment_id ?? row.id),
    amount: money(row.amount ?? row.paid_amount),
    received: money(row.total),
    status: text(row.status_label ?? row.status),
    method: text(row.method ?? row.payment_method),
    paidAt: moment(row.paid_at ?? row.payment_date ?? row.created_at),
  }
}

function detailBox(detail) {
  if (detail?.data && typeof detail.data === "object" && !Array.isArray(detail.data)) return detail.data
  if (detail?.payment && typeof detail.payment === "object") return detail.payment
  return detail || {}
}

function parcelsIn(detail) {
  const box = detailBox(detail)
  const options = [box.consignments, box.orders, detail?.consignments, Array.isArray(detail?.data) ? detail.data : null]
  return options.find((item) => Array.isArray(item)) || []
}

function readParcel(row) {
  const cid = Number(row?.consignment_id ?? row?.cid)
  return {
    consignmentId: Number.isInteger(cid) && cid > 0 ? cid : null,
    invoice: text(row?.invoice).slice(0, 80),
    trackingCode: text(row?.tracking_code).slice(0, 80),
    amount: money(row?.cod_amount ?? row?.amount ?? row?.collected_amount),
  }
}

async function readState() {
  const found = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [STATE_KEY])
  return { at: null, complete: false, nextPage: 1, error: "", ...(found.rows[0]?.value || {}) }
}

async function writeState(state) {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [STATE_KEY, JSON.stringify(state)],
  )
}

async function savePayment(info, raw) {
  const result = await pool.query(
    `INSERT INTO steadfast_payments (ref, label, amount, status, method, paid_at, raw, received)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (ref) DO UPDATE SET
       label = EXCLUDED.label,
       amount = COALESCE(EXCLUDED.amount, steadfast_payments.amount),
       received = COALESCE(EXCLUDED.received, steadfast_payments.received),
       status = CASE WHEN EXCLUDED.status <> '' THEN EXCLUDED.status ELSE steadfast_payments.status END,
       method = CASE WHEN EXCLUDED.method <> '' THEN EXCLUDED.method ELSE steadfast_payments.method END,
       paid_at = COALESCE(EXCLUDED.paid_at, steadfast_payments.paid_at),
       detail_at = CASE WHEN steadfast_payments.raw IS DISTINCT FROM EXCLUDED.raw THEN NULL ELSE steadfast_payments.detail_at END,
       updated_at = CASE WHEN steadfast_payments.raw IS DISTINCT FROM EXCLUDED.raw THEN now() ELSE steadfast_payments.updated_at END,
       raw = EXCLUDED.raw
     RETURNING (xmax = 0) AS inserted`,
    [info.ref, info.label, info.amount, info.status, info.method, info.paidAt, JSON.stringify(raw), info.received],
  )
  return result.rows[0].inserted
}

async function fetchDetail(keys, raw) {
  const tries = [...new Set([text(raw.id), text(raw.payment_id)].filter(Boolean))]
  let lastError = null
  for (const id of tries) {
    try {
      return await steadfast(keys, `/payments/${encodeURIComponent(id)}`)
    } catch (error) {
      lastError = error
      if (error.steadfastStatus !== 404) throw error
    }
  }
  throw lastError || fail(502, "Steadfast did not return this payment")
}

async function saveDetail(ref, detail) {
  const info = readPayment(detailBox(detail))
  const parcels = parcelsIn(detail)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `UPDATE steadfast_payments SET
         detail = $2::jsonb, detail_at = now(),
         amount = COALESCE(amount, $3), paid_at = COALESCE(paid_at, $4),
         status = CASE WHEN status = '' THEN $5 ELSE status END,
         method = CASE WHEN method = '' THEN $6 ELSE method END,
         received = COALESCE(received, $7)
       WHERE ref = $1`,
      [ref, JSON.stringify(detail), info?.amount ?? null, info?.paidAt ?? null, info?.status || "", info?.method || "", info?.received ?? null],
    )
    if (parcels.length) {
      await client.query(`DELETE FROM steadfast_payment_parcels WHERE payment_ref = $1`, [ref])
      for (const [position, row] of parcels.entries()) {
        const parcel = readParcel(row)
        await client.query(
          `INSERT INTO steadfast_payment_parcels (payment_ref, position, consignment_id, invoice, tracking_code, amount, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [ref, position, parcel.consignmentId, parcel.invoice, parcel.trackingCode, parcel.amount, JSON.stringify(row)],
        )
      }
    }
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
}

async function matchOrders() {
  await pool.query(
    `UPDATE steadfast_payment_parcels pp SET order_id = o.id
     FROM orders o
     WHERE pp.order_id IS NULL AND pp.consignment_id IS NOT NULL AND o.consignment_id = pp.consignment_id`,
  )
  await pool.query(
    `UPDATE steadfast_payment_parcels pp SET order_id = o.id
     FROM orders o
     WHERE pp.order_id IS NULL
       AND pp.invoice ~* '^RG-[0-9]+(-[0-9]+)?$'
       AND o.id = (regexp_match(pp.invoice, '^RG-0*([0-9]+)', 'i'))[1]::int
       AND (pp.consignment_id IS NULL OR o.consignment_id IS NULL OR o.consignment_id = pp.consignment_id)`,
  )
}

async function walkPages(keys, state, deadline) {
  const seen = new Set()
  let added = 0
  let page = state.complete ? 1 : Math.max(1, Number(state.nextPage) || 1)
  for (; page <= MAX_PAGES; page += 1) {
    if (Date.now() > deadline) return { added, done: false, nextPage: page }
    const data = await steadfast(keys, `/payments?page=${page}`)
    const rows = listIn(data).map((raw) => ({ raw, info: readPayment(raw) })).filter((row) => row.info)
    if (!rows.length || rows.every((row) => seen.has(row.info.ref))) return { added, done: true, nextPage: 1 }
    let fresh = 0
    for (const { raw, info } of rows) {
      if (seen.has(info.ref)) continue
      seen.add(info.ref)
      if (await savePayment(info, raw)) fresh += 1
    }
    added += fresh
    const last = lastPage(data)
    if (last && page >= last) return { added, done: true, nextPage: 1 }
    if (state.complete && !fresh && page >= 2) return { added, done: true, nextPage: 1 }
  }
  return { added, done: true, nextPage: 1 }
}

async function fillDetails(keys, deadline) {
  const pending = await pool.query(`SELECT ref, raw FROM steadfast_payments WHERE detail_at IS NULL ORDER BY paid_at DESC NULLS LAST, first_seen DESC`)
  let filled = 0
  for (const row of pending.rows) {
    if (Date.now() > deadline) break
    try {
      await saveDetail(row.ref, await fetchDetail(keys, row.raw))
      filled += 1
    } catch (error) {
      console.error(error)
      if (error.status === 504 || error.status === 502) break
    }
  }
  return { filled, remaining: pending.rows.length - filled }
}

export async function syncPayments({ force = false } = {}) {
  const keys = await keysOrNull()
  if (!keys) {
    if (force) throw fail(400, "Add the Steadfast keys on the Courier page first")
    return { skipped: true }
  }
  const state = await readState()
  const fresh = state.at && Date.now() - new Date(state.at).getTime() < AUTO_GAP_MS
  if (!force && fresh && state.complete) return { skipped: true }
  const client = await pool.connect()
  try {
    const lock = await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_ID])
    if (!lock.rows[0].ok) return { busy: true }
    const deadline = Date.now() + BUDGET_MS
    try {
      const pages = await walkPages(keys, state, deadline)
      const details = await fillDetails(keys, deadline)
      await matchOrders()
      const next = { at: new Date().toISOString(), complete: state.complete || pages.done, nextPage: pages.done ? 1 : pages.nextPage, error: "" }
      if (!pages.done) next.complete = false
      await writeState(next)
      return { added: pages.added, filled: details.filled, remaining: details.remaining, more: !pages.done || details.remaining > 0 }
    } catch (error) {
      await writeState({ ...state, at: new Date().toISOString(), error: error.message || "Sync failed" })
      throw error
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_ID])
    }
  } finally {
    client.release()
  }
}

export function syncPaymentsSoon() {
  syncPayments().catch((error) => console.error(error))
}

function shapePayment(row) {
  return {
    ref: row.ref,
    label: row.label || row.ref,
    amount: row.amount === null ? null : Number(row.amount),
    received: row.received === null || row.received === undefined ? null : Number(row.received),
    status: row.status,
    method: row.method,
    paidAt: row.paid_at,
    firstSeen: row.first_seen,
    parcels: row.parcels,
    matched: row.matched,
    loaded: Boolean(row.detail_at),
  }
}

export async function paymentList({ limit, offset }) {
  const [totals, rows, state] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS payouts, COALESCE(SUM(COALESCE(received, amount)), 0)::float8 AS amount, MAX(paid_at) AS last_paid,
              (SELECT COUNT(*)::int FROM steadfast_payment_parcels) AS parcels
       FROM steadfast_payments`,
    ),
    pool.query(
      `SELECT p.ref, p.label, p.amount::float8 AS amount, p.received::float8 AS received, p.status, p.method, p.paid_at, p.first_seen, p.detail_at,
              COUNT(pp.position)::int AS parcels, COUNT(pp.order_id)::int AS matched
       FROM steadfast_payments p
       LEFT JOIN steadfast_payment_parcels pp ON pp.payment_ref = p.ref
       GROUP BY p.ref
       ORDER BY p.paid_at DESC NULLS LAST, p.first_seen DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    readState(),
  ])
  const sum = totals.rows[0]
  return {
    payments: rows.rows.map(shapePayment),
    total: sum.payouts,
    totals: { payouts: sum.payouts, amount: Number(sum.amount), parcels: sum.parcels, lastPaid: sum.last_paid },
    sync: { at: state.at, complete: state.complete, error: state.error },
  }
}

function scalars(object) {
  if (!object || typeof object !== "object") return []
  return Object.entries(object)
    .filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
    .map(([key, value]) => ({ key, value: value === null ? "" : String(value) }))
}

export async function paymentDetail(ref) {
  const found = await pool.query(
    `SELECT p.*, p.amount::float8 AS amount, p.received::float8 AS received,
            (SELECT COUNT(*)::int FROM steadfast_payment_parcels WHERE payment_ref = p.ref) AS parcels,
            (SELECT COUNT(order_id)::int FROM steadfast_payment_parcels WHERE payment_ref = p.ref) AS matched
     FROM steadfast_payments p WHERE p.ref = $1`,
    [ref],
  )
  const row = found.rows[0]
  if (!row) throw fail(404, "Payment was not found")
  const parcels = await pool.query(
    `SELECT pp.position, pp.consignment_id, pp.invoice, pp.tracking_code, pp.amount::float8 AS amount, pp.order_id, pp.raw,
            o.customer_name, o.status
     FROM steadfast_payment_parcels pp
     LEFT JOIN orders o ON o.id = pp.order_id
     WHERE pp.payment_ref = $1
     ORDER BY pp.position`,
    [ref],
  )
  const box = row.detail ? detailBox(row.detail) : {}
  const facts = new Map(scalars(row.raw).map((item) => [item.key, item.value]))
  for (const item of scalars(box)) if (!facts.has(item.key) || facts.get(item.key) === "") facts.set(item.key, item.value)
  return {
    payment: shapePayment(row),
    facts: [...facts.entries()].map(([key, value]) => ({ key, value })),
    parcels: parcels.rows.map((item) => ({
      position: item.position,
      consignmentId: item.consignment_id ? Number(item.consignment_id) : null,
      invoice: item.invoice,
      trackingCode: item.tracking_code,
      amount: item.amount === null ? null : Number(item.amount),
      orderId: item.order_id,
      orderNumber: item.order_id ? `RG-${String(item.order_id).padStart(4, "0")}` : "",
      customerName: item.customer_name || text(item.raw?.recipient_name),
      orderStatus: item.status || "",
      facts: scalars(item.raw),
    })),
  }
}
