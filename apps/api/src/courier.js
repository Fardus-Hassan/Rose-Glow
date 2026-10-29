import { randomBytes } from "node:crypto"
import { courierStatusLabel } from "@rose/shared"
import { pool } from "./db.js"
import { fail } from "./http.js"
import { getOrder, setOrderStatus } from "./orders.js"
import { open, sameText, seal } from "./secret.js"
import { isDuplicate, readBalance, readConsignment, readStatus, readSteps, steadfast } from "./steadfast.js"

const EARLY = new Set(["in_review", "pending"])
const CANCELLED = new Set(["cancelled", "cancelled_return_processing", "cancelled_return_rider_assigned"])
const FINAL = new Set(["delivered", "partial_delivered", "cancelled_return_received", "partial_delivered_return_received"])

export function isSteadfast(name) {
  return String(name || "").trim().toLowerCase() === "steadfast"
}

export async function bookIfNeeded(order) {
  if (!order || !isSteadfast(order.courier) || order.status !== "courier" || order.consignmentId) return order
  try {
    await bookOrder(order.id)
  } catch (error) {
    const message = error.status && error.status < 500 ? error.message : (error.message || "Could not send to Steadfast")
    await pool.query(
      `UPDATE orders SET courier_error = $2 WHERE id = $1 AND consignment_id IS NULL`,
      [order.id, message],
    )
  }
  return getOrder(order.id)
}

export async function bookOrder(id) {
  const order = await getOrder(id)
  if (!isSteadfast(order.courier)) throw fail(400, "Courier is not Steadfast")
  if (order.status === "cancelled" || order.status === "returned") throw fail(400, "Cancelled or returned orders cannot be sent")
  if (order.consignmentId) return order
  const keys = await requireKeys()
  const parcel = await place(keys, order)
  await pool.query(
    `UPDATE orders
     SET consignment_id = $2, tracking_code = NULLIF($3, ''), tracking_url = NULLIF($4, ''),
         courier_status = $5, courier_status_at = now(), courier_error = NULL,
         courier_sent_at = COALESCE(courier_sent_at, now()), cod_booked = $6
     WHERE id = $1 AND consignment_id IS NULL`,
    [order.id, parcel.id, parcel.code, parcel.link, parcel.status || "in_review", codFor(order)],
  )
  await remember(order, parcel.status || "in_review", parcel.id, `${order.number} booked with Steadfast${parcel.code ? `. Tracking ${parcel.code}` : ""}`, `book:${order.id}:${parcel.id}`)
  if (order.status === "new" || order.status === "confirmed") {
    await setOrderStatus(order.id, "courier", ["new", "confirmed"])
  }
  return getOrder(order.id)
}

export async function trackOrder(id) {
  const order = await getOrder(id)
  if (!order.consignmentId) throw fail(400, "This order has not been sent to Steadfast yet")
  const keys = await requireKeys()
  const statusData = await fetchStatus(keys, order.consignmentId)
  const status = readStatus(statusData)
  if (status) await applyRemote(order, status, "")
  let steps = []
  try {
    steps = readSteps(await steadfast(keys, `/trackings_by_invoice/${encodeURIComponent(invoiceFor(order))}`))
  } catch {
    steps = []
  }
  const fresh = await getOrder(id)
  return { order: fresh, steps, stages: await stagesFor(fresh, steps) }
}

const DONE_DELIVERY = new Set(["delivered", "partial_delivered", "partial_delivered_return_processing", "partial_delivered_return_rider_assigned", "partial_delivered_return_received"])
const RIDER_REPORTED = new Set(["delivered_approval_pending", "partial_delivered_approval_pending", ...DONE_DELIVERY])
const isCancelled = (status) => status === "cancelled" || status.startsWith("cancelled_return")

// Mirrors the four steps in the Steadfast panel, using only what Steadfast has told us:
// the booking, each status it sent (first time seen), and its own "Assigned to rider" message.
async function stagesFor(order, steps) {
  const { rows } = await pool.query(
    `SELECT status, created_at, idempotency_key FROM courier_events WHERE order_id = $1 AND consignment_id = $2 ORDER BY created_at, id`,
    [order.id, order.consignmentId],
  )
  const bookedAt = rows.find((row) => row.idempotency_key === `book:${order.id}:${order.consignmentId}`)?.created_at || null
  const firstAt = (test) => rows.find((row) => test(row.status || ""))?.created_at || null
  const now = order.courierStatus || ""
  const approvedTest = (status) => status && status !== "in_review" && !isCancelled(status) && status !== "cancelled_approval_pending"
  const riderStep = steps
    .filter((step) => /^assigned to rider/i.test(step.text))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))[0]
  const deliveredAt = firstAt((status) => DONE_DELIVERY.has(status))
  const approvedAt = firstAt((status) => status === "pending")
  const cancelled = isCancelled(now)
  const final = cancelled
    ? { id: "end", label: "Cancelled", tone: "bad", done: true, at: firstAt(isCancelled) }
    : { id: "end", label: now.startsWith("partial_delivered") && DONE_DELIVERY.has(now) ? "Partly delivered" : "Delivered", done: DONE_DELIVERY.has(now), at: deliveredAt }
  return [
    { id: "entered", label: "Entered", done: true, at: bookedAt },
    { id: "approved", label: "Approved", done: Boolean(approvedAt) || approvedTest(now), at: approvedAt },
    { id: "rider", label: "With a rider", done: Boolean(riderStep) || RIDER_REPORTED.has(now), at: riderStep?.at || null },
    final,
  ]
}

export async function requestReturn(id, reason) {
  const order = await getOrder(id)
  if (!order.consignmentId) throw fail(400, "This order has not been sent to Steadfast yet")
  const keys = await requireKeys()
  const note = String(reason || "Customer asked for a return").trim().slice(0, 500)
  await steadfast(keys, "/create_return_request", {
    method: "POST",
    body: { consignment_id: order.consignmentId, reason: note },
  })
  await applyRemote(order, "cancelled_return_processing", "Return requested")
  return getOrder(id)
}

// Steadfast's API cannot remove a parcel. After the owner removes it in the Steadfast panel,
// this unlinks it here so the order can be fixed and sent again.
export async function forgetParcel(id) {
  const order = await getOrder(id)
  if (!order.consignmentId) throw fail(400, "This order has not been sent to Steadfast yet")
  if (order.courierStatus && !EARLY.has(order.courierStatus)) {
    throw fail(400, "Steadfast has already taken this parcel. Only a parcel still in review can be removed.")
  }
  const cleared = await pool.query(
    `UPDATE orders
     SET consignment_id = NULL, tracking_code = NULL, tracking_url = NULL,
         courier_status = NULL, courier_status_at = NULL, courier_error = NULL, courier_sent_at = NULL,
         courier_charge = NULL, courier_charge_by = NULL, courier_cod = NULL, cod_booked = NULL,
         courier_tries = courier_tries + 1
     WHERE id = $1 AND consignment_id = $2
     RETURNING id`,
    [order.id, order.consignmentId],
  )
  if (!cleared.rows[0]) return getOrder(id)
  await setOrderStatus(order.id, "confirmed", ["courier"])
  return getOrder(id)
}

export async function activeCouriers() {
  const row = await accountRow()
  const couriers = []
  if (row) couriers.push({ id: "steadfast", name: "Steadfast" })
  return couriers
}

export async function accountView(req) {
  const row = await accountRow()
  return publicAccount(row, req)
}

export async function saveAccount(body, req) {
  const apiKey = String(body.apiKey || "").trim()
  const secretKey = String(body.secretKey || "").trim()
  const webhookToken = String(body.webhookToken || "").trim() || randomBytes(24).toString("hex")
  if (apiKey.length < 8 || secretKey.length < 8) throw fail(400, "Enter the API key and secret key")
  if (webhookToken.length < 8) throw fail(400, "Use a longer webhook token")
  const data = await steadfast({ apiKey, secretKey }, "/get_balance")
  const balance = readBalance(data)
  await pool.query(
    `INSERT INTO courier_accounts (id, api_key_enc, secret_key_enc, key_hint, webhook_token_enc, balance, checked_at, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       api_key_enc = EXCLUDED.api_key_enc,
       secret_key_enc = EXCLUDED.secret_key_enc,
       key_hint = EXCLUDED.key_hint,
       webhook_token_enc = EXCLUDED.webhook_token_enc,
       balance = EXCLUDED.balance,
       checked_at = now(),
       updated_at = now()`,
    [seal(apiKey), seal(secretKey), hint(apiKey), seal(webhookToken), balance],
  )
  return accountView(req)
}

export async function refreshBalance() {
  const keys = await requireKeys()
  const balance = readBalance(await steadfast(keys, "/get_balance"))
  await pool.query(`UPDATE courier_accounts SET balance = $1, checked_at = now(), updated_at = now() WHERE id = 1`, [balance])
  return { balance, checkedAt: new Date().toISOString() }
}

export async function disconnectAccount() {
  await pool.query(`DELETE FROM courier_accounts WHERE id = 1`)
  return { connected: false }
}

export async function parcelList({ limit, offset }) {
  const where = "WHERE o.consignment_id IS NOT NULL"
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE o.courier_charge IS NOT NULL)::int AS known,
            COALESCE(SUM(o.courier_charge), 0)::float8 AS charged,
            COALESCE(SUM(o.courier_cod), 0)::float8 AS collected
     FROM orders o ${where}`,
  )
  const result = await pool.query(
    `SELECT o.id, o.customer_name, o.mobile, o.status, o.consignment_id, o.tracking_code, o.tracking_url,
            o.courier_status, o.courier_error, o.courier_status_at,
            o.courier_charge::float8 AS courier_charge, o.courier_charge_by, o.courier_cod::float8 AS courier_cod,
            m.courier_cost::float8 AS courier_cost
     FROM orders o
     JOIN order_money m ON m.id = o.id
     ${where}
     ORDER BY o.courier_status_at DESC NULLS LAST, o.id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  )
  const totals = count.rows[0]
  return {
    parcels: result.rows.map(parcelRow),
    total: totals.total,
    money: { known: totals.known, charged: Number(totals.charged), collected: Number(totals.collected) },
  }
}

export async function notificationFeed(limit) {
  try {
    await syncParcels()
  } catch (error) {
    console.error(error)
  }
  return listNotifications(limit)
}

async function listNotifications(limit = 20) {
  const [counts, items] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread, COUNT(*)::int AS total
       FROM courier_events`,
    ),
    pool.query(
      `SELECT id, order_id, status, message, created_at, read_at IS NULL AS unread
       FROM courier_events
       ORDER BY created_at DESC, id DESC
       LIMIT $1`,
      [limit],
    ),
  ])
  return {
    unread: counts.rows[0].unread,
    total: counts.rows[0].total,
    items: items.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      status: row.status,
      message: row.message,
      at: row.created_at,
      unread: row.unread,
    })),
  }
}

export async function markNotifications(ids, limit) {
  if (Array.isArray(ids) && ids.length) {
    const clean = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0).slice(0, 50)
    if (clean.length) await pool.query(`UPDATE courier_events SET read_at = now() WHERE id = ANY($1::int[]) AND read_at IS NULL`, [clean])
  } else {
    await pool.query(`UPDATE courier_events SET read_at = now() WHERE read_at IS NULL`)
  }
  return listNotifications(limit)
}

export async function receiveWebhook(req) {
  const row = await accountRow()
  if (!row?.webhook_token_enc) throw fail(401, "Webhook is not set up")
  const header = req.get("authorization") || ""
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : ""
  if (!sameText(token, open(row.webhook_token_enc))) throw fail(401, "Webhook token does not match")
  const event = req.body && typeof req.body === "object" ? req.body : {}
  const type = String(event.notification_type || "delivery_status")
  const consignmentId = Number(event.consignment_id)
  const order = await findOrder(consignmentId, event.invoice)
  if (!order) return { ok: true }
  const idem = String(req.get("idempotency-key") || "").slice(0, 200)
  const note = String(event.tracking_message || "").trim()
  if (type === "tracking_update") {
    if (note) await remember(order, order.courierStatus || "tracking", order.consignmentId, `${order.number}: ${note}`, idem || `track:${order.id}:${note}:${event.updated_at || ""}`)
    return { ok: true }
  }
  const status = String(event.status || "").trim().toLowerCase()
  if (!status) return { ok: true }
  await recordMoney(order.id, status, { charge: amount(event.delivery_charge), cod: amount(event.cod_amount) })
  await applyRemote(order, status, note, idem)
  await keepPayload(order.id, status, event)
  return { ok: true }
}

// Steadfast's delivery_status webhook carries delivery_charge and cod_amount.
// A zero charge before the parcel settles is a placeholder, so only a final status or a real charge is kept.
// A charge typed in by hand stays until it is cleared.
async function recordMoney(orderId, status, { charge, cod }) {
  const settled = FINAL.has(status) || status === "cancelled"
  if (charge !== null && (settled || charge > 0)) {
    await pool.query(
      `UPDATE orders SET courier_charge = $2, courier_charge_by = 'steadfast'
       WHERE id = $1 AND courier_charge_by IS DISTINCT FROM 'manual' AND courier_charge IS DISTINCT FROM $2`,
      [orderId, charge],
    )
  }
  if (cod === null || (status !== "delivered" && status !== "partial_delivered")) return
  await pool.query(
    `UPDATE orders o
     SET cod_booked = COALESCE(o.cod_booked, GREATEST(m.total - o.paid_amount, 0)),
         courier_cod = $2,
         paid_amount = LEAST(m.total, GREATEST(0, m.total - COALESCE(o.cod_booked, GREATEST(m.total - o.paid_amount, 0)) + $2))
     FROM order_money m
     WHERE m.id = o.id AND o.id = $1 AND o.courier_cod IS DISTINCT FROM $2`,
    [orderId, cod],
  )
}

function codFor(order) {
  return Math.max(0, Math.round(Number(order.due) || 0))
}

function amount(value) {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n < 10000000 ? Math.round(n * 100) / 100 : null
}

// A parcel removed in Steadfast keeps its invoice there, so each new booking gets a fresh one.
function invoiceFor(order) {
  return order.courierTries > 0 ? `${order.number}-${order.courierTries + 1}` : order.number
}

async function place(keys, order) {
  const description = (order.items || []).map((item) => `${item.name} × ${item.quantity}${item.gift ? " (gift)" : ""}`).join(", ").slice(0, 250)
  const body = {
    invoice: invoiceFor(order),
    recipient_name: order.customerName.slice(0, 100),
    recipient_phone: order.mobile,
    recipient_address: order.address.slice(0, 250),
    cod_amount: codFor(order),
    note: (order.note || order.number).slice(0, 400),
    item_description: description || "Rose Glow",
    total_lot: Math.max(1, (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)),
    delivery_type: 0,
  }
  try {
    return readConsignment(await steadfast(keys, "/create_order", { method: "POST", body }))
  } catch (error) {
    if (!isDuplicate(error)) throw error
    const statusData = await steadfast(keys, `/status_by_invoice/${encodeURIComponent(invoiceFor(order))}`)
    const tracks = await steadfast(keys, `/trackings_by_invoice/${encodeURIComponent(invoiceFor(order))}`).catch(() => ({}))
    const steps = readSteps(tracks)
    const id = steps.find((step) => step.consignmentId)?.consignmentId
    if (!id) throw error
    return { id, code: "", link: "", status: readStatus(statusData) || "in_review" }
  }
}

async function fetchStatus(keys, consignmentId) {
  try {
    return await steadfast(keys, `/status_with_return_status_by_cid/${consignmentId}`)
  } catch (error) {
    if (error.steadfastStatus !== 404 && error.status !== 404) throw error
    return steadfast(keys, `/status_by_cid/${consignmentId}`)
  }
}

async function syncParcels() {
  if (!await claimSync()) return
  const keys = await keysOrNull()
  if (!keys) return
  const result = await pool.query(
    `SELECT id, customer_name, consignment_id, courier_status, status
     FROM orders
     WHERE consignment_id IS NOT NULL
       AND (courier_status IS NULL OR courier_status <> ALL($1::text[]))
     ORDER BY courier_status_at NULLS FIRST, id
     LIMIT 12`,
    [[...FINAL]],
  )
  for (const row of result.rows) {
    try {
      const data = await fetchStatus(keys, row.consignment_id)
      const status = readStatus(data)
      if (!status) continue
      await applyRemote(shapeOrder(row), status, "")
    } catch (error) {
      console.error(error)
    }
  }
}

async function claimSync() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(`INSERT INTO courier_sync (id, synced_at) VALUES (1, '1970-01-01') ON CONFLICT (id) DO NOTHING`)
    const row = await client.query(`SELECT synced_at FROM courier_sync WHERE id = 1 FOR UPDATE`)
    const last = new Date(row.rows[0].synced_at).getTime()
    if (Date.now() - last < 55000) {
      await client.query("COMMIT")
      return false
    }
    await client.query(`UPDATE courier_sync SET synced_at = now() WHERE id = 1`)
    await client.query("COMMIT")
    return true
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
}

async function keepPayload(orderId, status, payload) {
  await pool.query(
    `UPDATE courier_events SET payload = $3::jsonb
     WHERE id = (SELECT id FROM courier_events WHERE order_id = $1 AND status = $2 ORDER BY created_at DESC, id DESC LIMIT 1)
       AND payload IS NULL`,
    [orderId, status, JSON.stringify(payload)],
  )
}

async function applyRemote(order, status, note, idempotencyKey) {
  const updated = await pool.query(
    `UPDATE orders
     SET courier_status = $2, courier_status_at = now(), courier_error = NULL
     WHERE id = $1 AND (courier_status IS DISTINCT FROM $2)
     RETURNING id`,
    [order.id, status],
  )
  if (!updated.rows[0]) return
  const label = courierStatusLabel(status)
  const text = note ? `${order.number}: ${note}` : `${order.number} · ${order.customerName}: ${label}`
  await remember(order, status, order.consignmentId, text, idempotencyKey || `status:${order.id}:${status}`)
  if (status === "delivered") await markPaid(order.id)
  const local = localStatusFor(status)
  if (!local || local === order.status) return
  const allowed = local === "returned"
    ? ["new", "confirmed", "courier", "delivered", "cancelled"]
    : ["new", "confirmed", "courier", "cancelled"]
  // A cancelled parcel is still on its way back, so its pieces stay held until the return is received.
  await setOrderStatus(order.id, local, allowed, { keepStock: local === "cancelled" })
}

async function markPaid(orderId) {
  await pool.query(
    `UPDATE orders o
     SET paid_amount = m.total
     FROM order_money m
     WHERE m.id = o.id AND o.id = $1 AND o.courier_cod IS NULL AND o.paid_amount < m.total`,
    [orderId],
  )
}

function localStatusFor(status) {
  if (status === "delivered" || status === "partial_delivered") return "delivered"
  if (status === "cancelled_return_received") return "returned"
  if (CANCELLED.has(status)) return "cancelled"
  return ""
}

async function remember(order, status, consignmentId, message, key) {
  await pool.query(
    `INSERT INTO courier_events (order_id, consignment_id, status, message, idempotency_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [order.id, consignmentId || null, status || "", message, key],
  )
}

async function findOrder(consignmentId, invoice) {
  if (Number.isInteger(consignmentId) && consignmentId > 0) {
    const byCid = await pool.query(
      `SELECT id, customer_name, consignment_id, courier_status, status FROM orders WHERE consignment_id = $1`,
      [consignmentId],
    )
    if (byCid.rows[0]) return shapeOrder(byCid.rows[0])
  }
  const match = String(invoice || "").match(/^RG-(\d+)(?:-\d+)?$/i)
  if (!match) return null
  const byInvoice = await pool.query(
    `SELECT id, customer_name, consignment_id, courier_status, status FROM orders WHERE id = $1`,
    [Number(match[1])],
  )
  const row = byInvoice.rows[0]
  if (!row) return null
  if (Number.isInteger(consignmentId) && consignmentId > 0 && Number(row.consignment_id) !== consignmentId) return null
  return shapeOrder(row)
}

function shapeOrder(row) {
  const id = row.id
  return {
    id,
    number: `RG-${String(id).padStart(4, "0")}`,
    customerName: row.customer_name,
    consignmentId: row.consignment_id ? Number(row.consignment_id) : null,
    courierStatus: row.courier_status || "",
    status: row.status,
  }
}

async function requireKeys() {
  const keys = await keysOrNull()
  if (!keys) throw fail(400, "Add the Steadfast keys on the Courier page first")
  return keys
}

async function keysOrNull() {
  const row = await accountRow()
  if (!row) return null
  try {
    return { apiKey: open(row.api_key_enc), secretKey: open(row.secret_key_enc) }
  } catch {
    throw fail(500, "Saved Steadfast keys could not be read. Add them again")
  }
}

async function accountRow() {
  const result = await pool.query(
    `SELECT api_key_enc, secret_key_enc, key_hint, webhook_token_enc, balance::float8 AS balance, checked_at
     FROM courier_accounts WHERE id = 1`,
  )
  return result.rows[0] || null
}

function publicAccount(row, req) {
  if (!row) return { connected: false, webhookUrl: webhookUrl(req) }
  let webhookToken = ""
  try {
    webhookToken = row.webhook_token_enc ? open(row.webhook_token_enc) : ""
  } catch {
    webhookToken = ""
  }
  return {
    connected: true,
    keyHint: row.key_hint,
    balance: row.balance === null || row.balance === undefined ? null : Number(row.balance),
    checkedAt: row.checked_at,
    webhookToken,
    webhookUrl: webhookUrl(req),
  }
}

function webhookUrl(req) {
  const proto = req.get("x-forwarded-proto") || (process.env.VERCEL ? "https" : req.protocol)
  return `${proto}://${req.get("host")}/api/courier/steadfast/webhook`
}

function hint(apiKey) {
  return apiKey.slice(-4)
}

function parcelRow(row) {
  return {
    id: row.id,
    number: `RG-${String(row.id).padStart(4, "0")}`,
    customerName: row.customer_name,
    mobile: row.mobile,
    status: row.status,
    consignmentId: Number(row.consignment_id),
    trackingCode: row.tracking_code || "",
    trackingUrl: row.tracking_url || "",
    courierStatus: row.courier_status || "",
    courierError: row.courier_error || "",
    courierStatusAt: row.courier_status_at,
    courierCharge: row.courier_charge === null ? null : Number(row.courier_charge),
    courierChargeBy: row.courier_charge_by || "",
    courierCod: row.courier_cod === null ? null : Number(row.courier_cod),
    courierCost: Number(row.courier_cost),
  }
}
