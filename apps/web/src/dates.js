const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

export const PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "month", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "year", label: "This year" },
  { id: "lastYear", label: "Last year" },
  { id: "custom", label: "Custom dates" },
]

export function todayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  return parts
}

export function iso(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function parts(value) {
  const [year, month, day] = value.split("-").map(Number)
  return { year, month, day }
}

export function addDays(value, days) {
  const { year, month, day } = parts(value)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
}

export function addMonths(value, count) {
  const { year, month } = parts(value)
  const next = new Date(Date.UTC(year, month - 1 + count, 1))
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 }
}

export function monthTitle(year, month) {
  return `${MONTHS[month - 1]} ${year}`
}

export function weekdayLabels() {
  return WEEKDAYS
}

export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells = Array.from({ length: first.getUTCDay() }, () => null)
  for (let day = 1; day <= days; day += 1) cells.push(iso(year, month, day))
  while (cells.length % 7) cells.push(null)
  return cells
}

export function rangeFor(preset, today = todayISO()) {
  const { year, month } = parts(today)
  if (preset === "today") return { from: today, to: today }
  if (preset === "yesterday") {
    const day = addDays(today, -1)
    return { from: day, to: day }
  }
  if (preset === "7") return { from: addDays(today, -6), to: today }
  if (preset === "30") return { from: addDays(today, -29), to: today }
  if (preset === "month") return { from: iso(year, month, 1), to: today }
  if (preset === "lastMonth") {
    const previous = addMonths(today, -1)
    const lastDay = new Date(Date.UTC(previous.year, previous.month, 0)).getUTCDate()
    return { from: iso(previous.year, previous.month, 1), to: iso(previous.year, previous.month, lastDay) }
  }
  if (preset === "year") return { from: iso(year, 1, 1), to: today }
  if (preset === "lastYear") return { from: iso(year - 1, 1, 1), to: iso(year - 1, 12, 31) }
  return null
}

export function matchPreset(range, today = todayISO()) {
  if (!range) return "all"
  return PRESETS.find((item) => {
    if (item.id === "custom") return false
    const next = rangeFor(item.id, today)
    return next.from === range.from && next.to === range.to
  })?.id || "custom"
}

export function formatDay(value) {
  const { year, month, day } = parts(value)
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`
}

export function formatRange(range) {
  if (!range?.from || !range?.to) return "All time"
  if (range.from === range.to) return formatDay(range.from)
  return `${formatDay(range.from)} – ${formatDay(range.to)}`
}
