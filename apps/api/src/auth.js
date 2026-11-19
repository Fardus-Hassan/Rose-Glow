import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { pool } from "./db.js"
import { fail } from "./http.js"

const KEY = "gate_password"
const COOKIE = "rg_gate"
const MONTH = 60 * 60 * 24 * 30
const DEFAULT_PASSWORD = "rose2026"
const failures = new Map()
let cachedHash = ""

function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(String(password), salt, 32)
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`
}

function matches(password, stored) {
  const parts = String(stored || "").split("$")
  if (parts.length !== 3 || parts[0] !== "scrypt") return false
  const salt = Buffer.from(parts[1], "base64url")
  const expected = Buffer.from(parts[2], "base64url")
  if (!salt.length || expected.length !== 32) return false
  const actual = scryptSync(String(password), salt, expected.length)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function readCookie(req, name) {
  const raw = req.headers.cookie || ""
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=")
    if (eq < 1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return ""
}

function https(req) {
  const proto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim()
  return proto === "https" || Boolean(req.secure)
}

function clientKey(req) {
  const forwarded = String(req.get("x-forwarded-for") || "").split(",")[0].trim()
  return forwarded || req.ip || "local"
}

function tooManyTries(req) {
  const hit = failures.get(clientKey(req))
  return Boolean(hit && hit.until > Date.now())
}

function noteFailure(req) {
  const key = clientKey(req)
  const hit = failures.get(key) || { count: 0, until: 0 }
  const count = (hit.until > Date.now() ? 0 : hit.count) + 1
  if (count >= 8) failures.set(key, { count: 0, until: Date.now() + 60_000 })
  else failures.set(key, { count, until: 0 })
}

function clearFailures(req) {
  failures.delete(clientKey(req))
}

export async function passwordHash() {
  if (cachedHash) return cachedHash
  const found = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [KEY])
  const value = found.rows[0]?.value
  if (typeof value === "string" && value.startsWith("scrypt$")) {
    cachedHash = value
    return value
  }
  const hash = hashPassword(DEFAULT_PASSWORD)
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [KEY, JSON.stringify(hash)],
  )
  const again = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [KEY])
  cachedHash = (typeof again.rows[0]?.value === "string" && again.rows[0].value) || hash
  return cachedHash
}

export function signedIn(req, hash) {
  const raw = readCookie(req, COOKIE)
  const dot = raw.lastIndexOf(".")
  if (dot < 1) return false
  const body = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  const expected = createHmac("sha256", hash).update(body).digest("base64url")
  const left = Buffer.from(sig)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false
  const exp = Number(Buffer.from(body, "base64url").toString("utf8"))
  return Number.isFinite(exp) && exp > Date.now()
}

export function writeSession(res, req, hash) {
  const exp = Date.now() + MONTH * 1000
  const body = Buffer.from(String(exp)).toString("base64url")
  const sig = createHmac("sha256", hash).update(body).digest("base64url")
  const bits = [
    `${COOKIE}=${body}.${sig}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${MONTH}`,
  ]
  if (https(req)) bits.push("Secure")
  res.setHeader("Set-Cookie", bits.join("; "))
}

export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`)
}

export function openToGuests(req) {
  const path = String(req.originalUrl || "").split("?")[0]
  if (req.method === "GET" && (path === "/api/health" || path === "/api/auth/session")) return true
  if (req.method === "POST" && (path === "/api/auth/login" || path === "/api/auth/logout")) return true
  if (req.method === "POST" && path === "/api/shop/orders") return true
  if (req.method === "POST" && path === "/api/courier/steadfast/webhook") return true
  return false
}

export async function login(req, res) {
  if (tooManyTries(req)) throw fail(429, "Too many tries. Wait a minute and try again.")
  const password = String(req.body?.password ?? "")
  const hash = await passwordHash()
  if (!password || !matches(password, hash)) {
    noteFailure(req)
    throw fail(401, "That password is not right")
  }
  clearFailures(req)
  writeSession(res, req, hash)
  return { ok: true }
}

export async function changePassword(req, res) {
  const current = String(req.body?.current ?? "")
  const next = String(req.body?.next ?? "").trim()
  const hash = await passwordHash()
  if (!matches(current, hash)) throw fail(400, "Current password is not right")
  if (next.length < 6 || next.length > 72) throw fail(400, "Use 6 to 72 characters")
  const saved = hashPassword(next)
  cachedHash = saved
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [KEY, JSON.stringify(saved)],
  )
  writeSession(res, req, saved)
  return { ok: true }
}
