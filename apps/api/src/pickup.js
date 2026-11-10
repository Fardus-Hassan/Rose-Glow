import { pool } from "./db.js"
import { fail, mobile, whole } from "./http.js"
import { keysOrNull } from "./courier.js"
import { isDuplicate, steadfast } from "./steadfast.js"

let stationsCache = null

export async function pickupView() {
  const keys = await keysOrNull()
  if (!keys) return { connected: false, place: null, requests: [], inReview: 0 }
  const [place, requests, waiting] = await Promise.all([
    pool.query(`SELECT address_id, police_station_id, thana, district, address, phone FROM pickup_places WHERE id = 1`),
    pool.query(
      `SELECT id, steadfast_id, thana, address, phone, note, estim_qty, still_open, created_at
       FROM pickup_requests ORDER BY id DESC LIMIT 40`,
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM orders WHERE consignment_id IS NOT NULL AND courier_status = 'in_review'`),
  ])
  return {
    connected: true,
    place: place.rows[0] ? placeRow(place.rows[0]) : null,
    requests: requests.rows.map(requestRow),
    inReview: waiting.rows[0]?.n || 0,
  }
}

export async function pickupStations() {
  const keys = await keysOrNull()
  if (!keys) throw fail(400, "Add the Steadfast keys on the Courier page first")
  return { stations: await stations(keys) }
}

export async function savePickupPlace(body) {
  const keys = await keysOrNull()
  if (!keys) throw fail(400, "Add the Steadfast keys on the Courier page first")
  const addressId = whole(body?.addressId)
  const stationId = whole(body?.policeStationId)
  const address = String(body?.address || "").trim().replace(/\s+/g, " ")
  const phone = mobile(body?.phone)
  if (!addressId || addressId <= 0 || addressId > 1000000000) throw fail(400, "Enter the pickup address number from Steadfast")
  if (!stationId || stationId <= 0) throw fail(400, "Choose a thana")
  if (!address || address.length > 255) throw fail(400, "Enter the pickup address, up to 255 characters")
  if (!phone) throw fail(400, "Enter an 11-digit mobile number")
  const station = (await stations(keys)).find((item) => item.id === stationId)
  if (!station) throw fail(400, "That thana is not in Steadfast's list")
  await pool.query(
    `INSERT INTO pickup_places (id, address_id, police_station_id, thana, district, address, phone, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       address_id = EXCLUDED.address_id,
       police_station_id = EXCLUDED.police_station_id,
       thana = EXCLUDED.thana,
       district = EXCLUDED.district,
       address = EXCLUDED.address,
       phone = EXCLUDED.phone,
       updated_at = now()`,
    [addressId, station.id, station.name, station.district, address, phone],
  )
  return pickupView()
}

export async function requestPickup(body) {
  const keys = await keysOrNull()
  if (!keys) throw fail(400, "Add the Steadfast keys on the Courier page first")
  const place = await pool.query(`SELECT * FROM pickup_places WHERE id = 1`)
  const saved = place.rows[0]
  if (!saved) throw fail(400, "Save the pickup place first")
  const qty = whole(body?.estimQty)
  const note = String(body?.note || "").trim()
  if (!qty || qty < 1 || qty > 500) throw fail(400, "Enter how many parcels are waiting, from 1 to 500")
  if (note.length > 500) throw fail(400, "The note is too long")
  const payload = {
    address_id: saved.address_id,
    police_station_id: saved.police_station_id,
    address: saved.address,
    contact_number: saved.phone,
    estim_qty: qty,
  }
  if (note) payload.note = note
  try {
    const data = await steadfast(keys, "/create_pickup_request", { method: "POST", body: payload })
    const read = readPickup(data)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(`UPDATE pickup_requests SET still_open = false WHERE address_id = $1 AND still_open`, [saved.address_id])
      await client.query(
        `INSERT INTO pickup_requests
           (steadfast_id, address_id, police_station_id, thana, address, phone, note, estim_qty, still_open, req_status, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)`,
        [read.id, saved.address_id, saved.police_station_id, saved.thana, saved.address, saved.phone, note, qty, read.reqStatus, JSON.stringify(read.raw)],
      )
      await client.query("COMMIT")
    } catch (error) {
      try { await client.query("ROLLBACK") } catch { /* already closed */ }
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    if (!stillPending(error)) throw error
    await pool.query(
      `UPDATE pickup_requests SET still_open = true
       WHERE id = (
         SELECT id FROM pickup_requests
         WHERE address_id = $1 AND steadfast_id IS NOT NULL
         ORDER BY id DESC LIMIT 1
       )`,
      [saved.address_id],
    )
    return { ...(await pickupView()), duplicate: true }
  }
  return pickupView()
}

async function stations(keys) {
  if (stationsCache && Date.now() - stationsCache.at < 6 * 60 * 60 * 1000) return stationsCache.list
  const data = await steadfast(keys, "/police_stations")
  const list = readStations(data)
  if (!list.length) throw fail(502, "Steadfast did not return any thana")
  stationsCache = { at: Date.now(), list }
  return list
}

function readStations(data) {
  const list = firstList(data)
  if (!list) {
    console.error("police_stations", JSON.stringify(data).slice(0, 500))
    throw fail(502, "Could not read Steadfast's thana list")
  }
  return list.flatMap((row) => {
    const id = Number(row?.id)
    const name = String(row?.name || "").trim()
    if (!Number.isInteger(id) || id <= 0 || !name) return []
    const district = typeof row.district === "string" ? row.district.trim() : ""
    return [{ id, name, district }]
  })
}

function firstList(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== "object") return null
  for (const key of ["police_stations", "data"]) {
    if (Array.isArray(data[key])) return data[key]
    if (Array.isArray(data[key]?.data)) return data[key].data
  }
  return null
}

function readPickup(data) {
  const inner = data?.data
  const row = inner && typeof inner === "object" && !Array.isArray(inner) ? inner : data
  const id = Number(row?.id)
  const status = Number(row?.req_status)
  return {
    id: Number.isInteger(id) && id > 0 ? id : null,
    reqStatus: Number.isInteger(status) ? status : null,
    raw: row && typeof row === "object" ? row : { reply: data },
  }
}

function stillPending(error) {
  return error?.steadfastStatus === 409 || isDuplicate(error)
}

function placeRow(row) {
  return {
    addressId: row.address_id,
    policeStationId: row.police_station_id,
    thana: row.thana,
    district: row.district || "",
    address: row.address,
    phone: row.phone,
  }
}

function requestRow(row) {
  return {
    id: row.id,
    steadfastId: row.steadfast_id ? Number(row.steadfast_id) : null,
    thana: row.thana,
    address: row.address,
    phone: row.phone,
    note: row.note || "",
    estimQty: row.estim_qty,
    open: row.still_open,
    createdAt: row.created_at,
  }
}
