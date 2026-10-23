export function fail(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

export function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

export function money(value) {
  if (value === "" || value === null || value === undefined) return 0
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 99999999) return null
  return Math.round(n * 100) / 100
}

export function whole(value, fallback = null) {
  if (value === "" || value === null || value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n)) return null
  return n
}

export function cleanName(value) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ")
  if (name.length < 2 || name.length > 80) return null
  return name
}

export function mobile(value) {
  let raw = String(value ?? "").replace(/[\s-]/g, "")
  if (raw.startsWith("+880")) raw = `0${raw.slice(4)}`
  else if (raw.startsWith("880")) raw = `0${raw.slice(3)}`
  if (!/^01\d{9}$/.test(raw)) return null
  return raw
}

export function when(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function noteText(value, max = 400) {
  return String(value ?? "").trim().slice(0, max)
}
