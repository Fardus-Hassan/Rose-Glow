import { fail } from "./http.js"

const BASE = "https://portal.packzy.com/api/v1"

export async function steadfast(keys, path, { method = "GET", body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "Api-Key": keys.apiKey,
        "Secret-Key": keys.secretKey,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (response.status >= 300 && response.status < 400) {
      throw fail(502, "Steadfast redirected the request, so the keys were not sent")
    }
    const text = await response.text()
    let data = {}
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        throw fail(502, "Could not read Steadfast's reply")
      }
    }
    const code = Number(data.status)
    const rejected = !response.ok || (Number.isInteger(code) && code >= 400)
    if (rejected) {
      if (response.status === 401 || code === 401) throw fail(400, "The Steadfast API key or secret does not match")
      if (response.status === 403 || code === 403) throw fail(400, "This Steadfast account cannot take orders right now")
      const message = firstMessage(data) || "Steadfast rejected this request"
      const error = fail(response.status === 422 || code === 422 ? 400 : 502, message)
      error.steadfastStatus = response.status
      throw error
    }
    return data
  } catch (error) {
    if (error.status) throw error
    if (error.name === "AbortError") throw fail(504, "Steadfast is taking too long. Try again in a moment")
    throw fail(502, "Could not reach Steadfast")
  } finally {
    clearTimeout(timer)
  }
}

function firstMessage(data) {
  if (typeof data.message === "string" && data.message.trim()) return data.message.trim()
  if (typeof data.error === "string" && data.error.trim()) return data.error.trim()
  if (data.errors && typeof data.errors === "object") {
    const first = Object.values(data.errors).flat().find((item) => typeof item === "string")
    if (first) return first
  }
  return ""
}

export function readBalance(data) {
  const raw = data.current_balance ?? data.balance ?? data.data?.current_balance ?? data.data?.balance
  const number = Number(raw)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null
}

export function readStatus(data) {
  const value = data.return_status || data.delivery_status || data.consignment?.status || data.status_name || ""
  const status = String(value || "").trim().toLowerCase()
  if (!status || status === "200" || status === "success") return ""
  return status
}

export function readConsignment(data) {
  const row = data.consignment || data.data || data
  const id = Number(row.consignment_id)
  if (!Number.isInteger(id) || id <= 0) throw fail(502, "Steadfast did not return a parcel number")
  const code = String(row.tracking_code || "").trim()
  const link = String(row.tracking_link || (code ? `https://steadfast.com.bd/t/${code}` : "")).trim()
  return { id, code, link, status: String(row.status || "in_review").trim().toLowerCase() }
}

export function readSteps(data) {
  const list = Array.isArray(data) ? data : data.trackings || data.data || data.tracking || []
  if (!Array.isArray(list)) return []
  return list.map((row) => ({
    consignmentId: Number(row.consignment_id) || null,
    text: String(row.text || row.tracking_message || row.message || "").trim(),
    at: row.created_at || row.updated_at || "",
  })).filter((row) => row.text)
}

export function isDuplicate(error) {
  return /already|duplicate|exists|unique/i.test(error?.message || "")
}
