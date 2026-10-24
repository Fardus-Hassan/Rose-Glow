import { randomBytes } from "node:crypto"
import { courierStatusLabel } from "@rose/shared"
import { pool } from "./db.js"
import { fail } from "./http.js"
import { getOrder, setOrderStatus } from "./orders.js"
import { open, sameText, seal } from "./secret.js"
import { isDuplicate, readBalance, readConsignment, readStatus, readSteps, steadfast } from "./steadfast.js"

const FINAL = new Set(["delivered", "partial_delivered", "cancelled_return_received", "partial_delivered_return_received"])

export function isSteadfast(name) {
  return String(name || "").trim().toLowerCase() === "steadfast"
}

export async function bookIfNeeded(order) {
  if (!order || !isSteadfast(order.courier) || order.status !== "courier" || order.consignmentId) return order
  try {
    await bookOrder(order.id)
  } catch (error) {
    const message = error.status && error.status < 500 ? error.message : (error.message || "Steadfast-এ পাঠানো যায়নি")
    await pool.query(
      `UPDATE orders SET courier_error = $2 WHERE id = $1 AND consignment_id IS NULL`,
      [order.id, message],
    )
  }
  return getOrder(order.id)
}

export async function bookOrder(id) {
  const order = await getOrder(id)
  if (!isSteadfast(order.courier)) throw fail(400, "কুরিয়ার Steadfast নয়")
  if (order.status === "cancelled" || order.status === "returned") throw fail(400, "বাতিল বা রিটার্ন অর্ডার পাঠানো যাবে না")
  if (order.consignmentId) return order
  const keys = await requireKeys()
  const parcel = await place(keys, order)
  await pool.query(
    `UPDATE orders
     SET consignment_id = $2, tracking_code = NULLIF($3, ''), tracking_url = NULLIF($4, ''),
         courier_status = $5, courier_status_at = now(), courier_error = NULL
     WHERE id = $1 AND consignment_id IS NULL`,
    [order.id, parcel.id, parcel.code, parcel.link, parcel.status || "in_review"],
  )
  await remember(order, parcel.status || "in_review", parcel.id, `${order.number} Steadfast-এ বুক হয়েছে${parcel.code ? `। ট্র্যাকিং ${parcel.code}` : ""}`, `book:${order.id}`)
  if (order.status === "new" || order.status === "confirmed") {
    await setOrderStatus(order.id, "courier", ["new", "confirmed"])
  }
  return getOrder(order.id)
}

export async function trackOrder(id) {
  const order = await getOrder(id)
  if (!order.consignmentId) throw fail(400, "এই অর্ডার এখনো Steadfast-এ যায়নি")
  const keys = await requireKeys()
  const statusData = await fetchStatus(keys, order.consignmentId)
  const status = readStatus(statusData)
  if (status) await applyRemote(order, status, "")
  let steps = []
  try {
    steps = readSteps(await steadfast(keys, `/trackings_by_invoice/${encodeURIComponent(order.number)}`))
  } catch {
    steps = []
  }
  return { order: await getOrder(id), steps }
}

export async function requestReturn(id, reason) {
  const order = await getOrder(id)
  if (!order.consignmentId) throw fail(400, "এই অর্ডার এখনো Steadfast-এ যায়নি")
  const keys = await requireKeys()
  const note = String(reason || "কাস্টমার ফেরত চেয়েছে").trim().slice(0, 500)
  await steadfast(keys, "/create_return_request", {
    method: "POST",
    body: { consignment_id: order.consignmentId, reason: note },
  })
  await applyRemote(order, "cancelled_return_processing", "ফেরতের অনুরোধ গেছে")
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
  if (apiKey.length < 8 || secretKey.length < 8) throw fail(400, "API কী আর সিক্রেট কী দিন")
  if (webhookToken.length < 8) throw fail(400, "ওয়েবহুক টোকেন আর একটু লম্বা দিন")
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

export async function parcelList() {
  const result = await pool.query(
    `SELECT id, customer_name, mobile, status, consignment_id, tracking_code, tracking_url, courier_status, courier_error, courier_status_at
     FROM orders
     WHERE consignment_id IS NOT NULL
     ORDER BY courier_status_at DESC NULLS LAST, id DESC
     LIMIT 40`,
  )
  return result.rows.map(parcelRow)
}

export async function notificationFeed() {
  try {
    await syncParcels()
  } catch (error) {
    console.error(error)
  }
  return listNotifications()
}

async function listNotifications() {
  const unread = await pool.query(`SELECT COUNT(*)::int AS count FROM courier_events WHERE read_at IS NULL`)
  const items = await pool.query(
    `SELECT id, order_id, status, message, created_at, read_at IS NULL AS unread
     FROM courier_events
     ORDER BY created_at DESC
     LIMIT 20`,
  )
  return {
    unread: unread.rows[0].count,
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

export async function markNotifications(ids) {
  if (Array.isArray(ids) && ids.length) {
    const clean = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0).slice(0, 50)
    if (clean.length) await pool.query(`UPDATE courier_events SET read_at = now() WHERE id = ANY($1::int[]) AND read_at IS NULL`, [clean])
  } else {
    await pool.query(`UPDATE courier_events SET read_at = now() WHERE read_at IS NULL`)
  }
  return listNotifications()
}

export async function receiveWebhook(req) {
  const row = await accountRow()
  if (!row?.webhook_token_enc) throw fail(401, "ওয়েবহুক সেট করা নেই")
  const header = req.get("authorization") || ""
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : ""
  if (!sameText(token, open(row.webhook_token_enc))) throw fail(401, "ওয়েবহুক টোকেন মেলেনি")
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
  if (status) await applyRemote(order, status, note, idem)
  return { ok: true }
}

async function place(keys, order) {
  const description = (order.items || []).map((item) => `${item.name} × ${item.quantity}`).join(", ").slice(0, 250)
  const body = {
    invoice: order.number,
    recipient_name: order.customerName.slice(0, 100),
    recipient_phone: order.mobile,
    recipient_address: order.address.slice(0, 250),
    cod_amount: Math.max(0, Math.round(Number(order.due) || 0)),
    note: (order.note || order.number).slice(0, 400),
    item_description: description || "Rose Glow",
    total_lot: Math.max(1, (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)),
    delivery_type: 0,
  }
  try {
    return readConsignment(await steadfast(keys, "/create_order", { method: "POST", body }))
  } catch (error) {
    if (!isDuplicate(error)) throw error
    const statusData = await steadfast(keys, `/status_by_invoice/${encodeURIComponent(order.number)}`)
    const tracks = await steadfast(keys, `/trackings_by_invoice/${encodeURIComponent(order.number)}`).catch(() => ({}))
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
  const local = localStatusFor(status)
  if (!local || local === order.status) return
  const allowed = local === "returned"
    ? ["new", "confirmed", "courier", "delivered"]
    : ["new", "confirmed", "courier"]
  await setOrderStatus(order.id, local, allowed)
}

function localStatusFor(status) {
  if (status === "delivered" || status === "partial_delivered") return "delivered"
  if (status === "cancelled_return_received") return "returned"
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
  const match = String(invoice || "").match(/^RG-(\d+)$/i)
  if (!match) return null
  const byInvoice = await pool.query(
    `SELECT id, customer_name, consignment_id, courier_status, status FROM orders WHERE id = $1`,
    [Number(match[1])],
  )
  return byInvoice.rows[0] ? shapeOrder(byInvoice.rows[0]) : null
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
  if (!keys) throw fail(400, "আগে কুরিয়ার পেজে Steadfast কী বসান")
  return keys
}

async function keysOrNull() {
  const row = await accountRow()
  if (!row) return null
  try {
    return { apiKey: open(row.api_key_enc), secretKey: open(row.secret_key_enc) }
  } catch {
    throw fail(500, "সেভ করা Steadfast কী পড়া যায়নি। আবার বসান")
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
  }
}
