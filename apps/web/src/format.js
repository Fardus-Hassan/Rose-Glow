import { paymentLabel, statusLabel } from "@rose/shared"

export { paymentLabel, statusLabel }

export function taka(value) {
  const amount = Number(value) || 0
  const rounded = Math.round(Math.abs(amount) * 100) / 100
  const digits = Number.isInteger(rounded) ? 0 : 2
  return `${amount < 0 && rounded > 0 ? "-" : ""}৳${new Intl.NumberFormat("en-BD", {
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  }).format(rounded)}`
}

export function dayLabel(iso) {
  const [year, month, day] = String(iso || "").split("-").map(Number)
  if (!year || !month || !day) return ""
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

export function when(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso))
}

export function orderNo(id) {
  return `RG-${String(id).padStart(4, "0")}`
}
