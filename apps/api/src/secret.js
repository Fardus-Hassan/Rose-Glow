import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto"

function key() {
  const raw = process.env.DATABASE_URL || ""
  if (!raw) throw new Error("DATABASE_URL নেই")
  return createHash("sha256").update(`rose-glow:courier:v1:${raw}`).digest()
}

export function seal(text) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const body = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, body]).toString("base64url")
}

export function open(payload) {
  const buf = Buffer.from(payload, "base64url")
  if (buf.length < 29) throw new Error("সেভ করা কী পড়া যায়নি")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const body = buf.subarray(28)
  const decipher = createDecipheriv("aes-256-gcm", key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")
}

export function sameText(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
