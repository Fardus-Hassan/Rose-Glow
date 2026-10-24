import { useLayoutEffect, useRef, useState } from "react"
import { taka } from "./format.js"
import { addDays, iso, parts } from "./dates.js"

const ORDER_COLOR = "#e06d78"
const AMOUNT_COLOR = "#3db8c9"

export function TrendChart({ points, from, to }) {
  const host = useRef(null)
  const [px, setPx] = useState(720)
  const buckets = bucketPoints(points, from, to)
  const [active, setActive] = useState(null)
  const ordersMax = Math.max(0, ...buckets.map((item) => item.orders))
  const amountMax = Math.max(0, ...buckets.map((item) => item.amount))
  useLayoutEffect(() => {
    const node = host.current
    if (!node) return undefined
    const measure = () => {
      const next = Math.round(node.clientWidth)
      if (next >= 280) setPx(next)
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(node)
    window.addEventListener("resize", measure)
    return () => {
      watch.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [ordersMax, amountMax])
  if (!ordersMax && !amountMax) {
    return <p className="muted chart-empty">No sales in this period.</p>
  }
  const orderScale = orderScaleOf(ordersMax)
  const amountScale = niceMax(amountMax)
  const width = px
  const height = 220
  const font = width < 520 ? 12 : 13
  const right = Math.max(56, axisAmount(amountScale).length * (font * 0.62) + 14)
  const left = Math.max(28, String(orderScale).length * (font * 0.7) + 16)
  const monthly = /^\d{4}-\d{2}$/.test(buckets[0]?.date || "")
  const innerW = width - left - right
  const slot = innerW / buckets.length
  const stacked = monthly && slot < 48
  const top = 16
  const bottom = monthly ? (stacked ? font + 28 : font + 16) : font + 28
  const innerH = height - top - bottom
  const base = height - bottom
  const barW = Math.max(4, Math.min(28, slot * 0.46))
  const xAt = (index) => left + slot * index + slot / 2
  const yAt = (value, max) => base - (max ? (value / max) * innerH : 0)
  const current = active == null ? null : buckets[active]
  const ticks = tickIndexes(buckets, slot)
  const steps = 4
  let lastOrderLabel = ""

  return (
    <div className="trend" ref={host}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ fontSize: font }} role="img" aria-label="Orders and sales trend" onPointerLeave={() => setActive(null)}>
        {Array.from({ length: steps + 1 }, (_, step) => {
          const y = base - (innerH / steps) * step
          const orderLabel = String(Math.round((orderScale / steps) * step))
          const showOrder = orderLabel !== lastOrderLabel
          if (showOrder) lastOrderLabel = orderLabel
          return (
            <g key={step}>
              <line x1={left} x2={width - right} y1={y} y2={y} className="trend-grid" />
              {showOrder ? <text x={left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="trend-axis">{orderLabel}</text> : null}
              <text x={width - right + 8} y={y} textAnchor="start" dominantBaseline="middle" className="trend-axis">{axisAmount((amountScale / steps) * step)}</text>
            </g>
          )
        })}
        <defs>
          <linearGradient id="trend-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f4b3b6" />
            <stop offset="1" stopColor="#d45362" />
          </linearGradient>
          <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3db8c9" stopOpacity="0.28" />
            <stop offset="1" stopColor="#3db8c9" stopOpacity="0" />
          </linearGradient>
        </defs>
        {lineRuns(buckets, xAt, (item) => yAt(item.amount, amountScale)).map((run, index) => run.length > 1 ? (
          <polygon key={`area-${index}`} points={`${run[0].x},${base} ${run.map((point) => `${point.x},${point.y}`).join(" ")} ${run[run.length - 1].x},${base}`} fill="url(#trend-area)" />
        ) : null)}
        {buckets.map((item, index) => {
          const heightOf = Math.max(item.orders ? 2 : 0, (item.orders / orderScale) * innerH)
          return (
            <rect
              key={item.date}
              x={xAt(index) - barW / 2}
              y={base - heightOf}
              width={barW}
              height={heightOf}
              rx="3"
              fill={index === active ? "#f7d0d2" : "url(#trend-bar)"}
            />
          )
        })}
        {lineRuns(buckets, xAt, (item) => yAt(item.amount, amountScale)).map((run, index) => run.length > 1 ? (
          <g key={`line-${index}`}>
            <polyline points={run.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={AMOUNT_COLOR} strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" opacity="0.2" />
            <polyline points={run.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={AMOUNT_COLOR} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ) : null)}
        {buckets.length <= 62 ? buckets.map((item, index) => item.amount > 0 ? (
          <circle key={`dot-${item.date}`} cx={xAt(index)} cy={yAt(item.amount, amountScale)} r={index === active ? 4.4 : 3.1} fill={AMOUNT_COLOR} stroke="#1e1c1a" strokeWidth="1.6" />
        ) : null) : null}
        {monthly ? ticks.map((index) => (
          <text key={buckets[index].date} x={xAt(index)} y={stacked && index % 2 ? height - 4 : height - (stacked ? font + 14 : 8)} textAnchor="middle" className="trend-label">{monthWord(parts(`${buckets[index].date}-01`).month, stacked ? 24 : slot)}</text>
        )) : (
          <>
            {monthSpans(buckets).map((span) => (
              <text key={`m-${span.month}`} x={xAt(span.start) - slot / 2 + 2} y={height - font - 8} textAnchor="start" className="trend-label trend-month">{monthWord(span.month, (span.end - span.start + 1) * slot)}</text>
            ))}
            {ticks.map((index) => (
              <text key={buckets[index].date} x={xAt(index)} y={height - 2} textAnchor="middle" className="trend-label">{parts(buckets[index].date).day}</text>
            ))}
          </>
        )}
        {buckets.map((item, index) => (
          <rect
            key={`hit-${item.date}`}
            x={left + slot * index}
            y={top}
            width={slot}
            height={innerH}
            fill="transparent"
            onPointerEnter={() => setActive(index)}
          />
        ))}
        {current ? <line x1={xAt(active)} x2={xAt(active)} y1={top} y2={base} className="trend-cursor" /> : null}
      </svg>
      {current ? (
        <div className={`trend-hover ${xAt(active) / width > 0.62 ? "left" : ""}`} style={{ left: `${(xAt(active) / width) * 100}%` }}>
          <strong>{current.full}</strong>
          <span><i style={{ background: ORDER_COLOR }} />Orders <b>{current.orders}</b></span>
          <span><i style={{ background: AMOUNT_COLOR }} />Sales <b>{taka(current.amount)}</b></span>
        </div>
      ) : null}
    </div>
  )
}

const SOURCE_COLORS = ["#e06d78", "#f0c14a", "#3db8c9", "#b794e0", "#7dcaa5", "#e09a5a", "#8f9ad4", "#e7d38a"]

export function SourceChart({ sources }) {
  if (!sources.length) return <p className="muted chart-empty">No orders from any source in this period.</p>
  const slices = sources.map((source, index) => ({
    id: source.id ?? source.name,
    name: source.name,
    value: source.orders,
    amount: source.amount,
    color: SOURCE_COLORS[index % SOURCE_COLORS.length],
  }))
  return (
    <div className="chart">
      <ShareDonut slices={slices} label="Orders" />
      <HBars rows={slices.map((source) => ({
        id: source.id,
        name: source.name,
        value: source.value,
        hint: taka(source.amount),
        color: source.color,
      }))} />
    </div>
  )
}

export function ShareDonut({ slices, label = "Orders" }) {
  const items = slices.filter((slice) => slice.value > 0)
  const total = items.reduce((sum, slice) => sum + slice.value, 0)
  if (!total) return <p className="muted chart-empty">No orders in this period.</p>
  const radius = 62
  const circ = 2 * Math.PI * radius
  const gap = items.length > 1 ? 4 : 0
  let offset = 0
  const segments = items.map((slice) => {
    const share = (slice.value / total) * circ
    const segment = { ...slice, length: Math.max(share - gap, 1), offset }
    offset += share
    return segment
  })
  return (
    <svg viewBox="0 0 160 160" role="img" aria-label={label}>
      <circle className="chart-track" cx="80" cy="80" r={radius} fill="none" strokeWidth="16" />
      {segments.map((segment) => (
        <circle
          key={segment.id}
          cx="80"
          cy="80"
          r={radius}
          fill="none"
          stroke={segment.color}
          strokeWidth="16"
          strokeDasharray={`${segment.length} ${circ - segment.length}`}
          strokeDashoffset={-segment.offset}
          transform="rotate(-90 80 80)"
        />
      ))}
      <text x="80" y="76" textAnchor="middle" className="chart-total">{total}</text>
      <text x="80" y="96" textAnchor="middle" className="chart-caption">{label}</text>
    </svg>
  )
}

export function StockMix({ cost, sell }) {
  const profit = Math.max(0, sell - cost)
  const costSlice = Math.max(0, Math.min(cost, sell))
  const total = costSlice + profit
  if (!total) return <p className="muted chart-empty">Stock has no value yet.</p>
  const slices = [
    { id: "cost", value: costSlice, color: "#3db8c9" },
    { id: "profit", value: profit, color: "#e06d78" },
  ].filter((slice) => slice.value > 0)
  const radius = 46
  const circ = 2 * Math.PI * radius
  const gap = slices.length > 1 ? 3 : 0
  let offset = 0
  const segments = slices.map((slice) => {
    const share = (slice.value / total) * circ
    const segment = { ...slice, length: Math.max(share - gap, 1), offset }
    offset += share
    return segment
  })
  return (
    <div className="stock-mix">
      <svg viewBox="0 0 148 148" role="img" aria-label="Stock cost and possible profit">
        <circle className="chart-track" cx="74" cy="74" r={radius} fill="none" strokeWidth="14" />
        {segments.map((segment) => (
          <circle
            key={segment.id}
            cx="74"
            cy="74"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth="14"
            strokeDasharray={`${segment.length} ${circ - segment.length}`}
            strokeDashoffset={-segment.offset}
            transform="rotate(-90 74 74)"
          />
        ))}
        <text x="74" y="70" textAnchor="middle" className="stock-mix-value">{taka(sell)}</text>
        <text x="74" y="88" textAnchor="middle" className="chart-caption">If sold</text>
      </svg>
      <div className="stock-key">
        <span><i style={{ background: "#3db8c9" }} />Cost</span>
        <span><i style={{ background: "#e06d78" }} />Profit</span>
      </div>
    </div>
  )
}

const BOOK_SLICES = [
  { id: "goods", name: "Goods", color: "#e4b3ae" },
  { id: "vehicle", name: "Vehicle", color: "#e7c08a" },
  { id: "courier", name: "Courier", color: "#3db8c9" },
  { id: "other", name: "Other", color: "#a89490" },
]

export function BooksMix({ goods = 0, vehicle = 0, courier = 0, other = 0 }) {
  const values = { goods, vehicle, courier, other }
  const slices = BOOK_SLICES.map((slice) => ({ ...slice, value: Math.max(0, Number(values[slice.id]) || 0) })).filter((slice) => slice.value > 0)
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const radius = 46
  const circ = 2 * Math.PI * radius
  const gap = slices.length > 1 ? 3 : 0
  let offset = 0
  const segments = slices.map((slice) => {
    const share = (slice.value / (total || 1)) * circ
    const segment = { ...slice, length: Math.max(share - gap, 1), offset }
    offset += share
    return segment
  })
  return (
    <div className="stock-mix">
      <svg viewBox="0 0 148 148" role="img" aria-label="Goods and the cost of bringing them in">
        <circle className="chart-track" cx="74" cy="74" r={radius} fill="none" strokeWidth="14" />
        {total > 0 ? segments.map((segment) => (
          <circle
            key={segment.id}
            cx="74"
            cy="74"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth="14"
            strokeDasharray={`${segment.length} ${circ - segment.length}`}
            strokeDashoffset={-segment.offset}
            transform="rotate(-90 74 74)"
          />
        )) : null}
        <text x="74" y="70" textAnchor="middle" className="stock-mix-value">{taka(total)}</text>
        <text x="74" y="88" textAnchor="middle" className="chart-caption">Brought in</text>
      </svg>
      <div className="stock-key">
        {BOOK_SLICES.map((slice) => (
          <span key={slice.id}><i style={{ background: slice.color }} />{slice.name}</span>
        ))}
      </div>
    </div>
  )
}

export function HBars({ rows, max }) {
  if (!rows.length) return null
  const peak = max || Math.max(...rows.map((row) => row.value), 1)
  return (
    <ul className="hbar">
      {rows.map((row) => (
        <li key={row.id}>
          <span>{row.name}</span>
          <div className="bar-track" aria-hidden="true">
            <div className="bar-fill" style={{ width: `${peak ? (row.value / peak) * 100 : 0}%`, background: row.color || undefined }} />
          </div>
          {row.hint ? <b className="hbar-orders">{row.value}</b> : null}
          <b className={row.hint ? "hbar-amount" : ""}>{row.hint ?? row.value}</b>
        </li>
      ))}
    </ul>
  )
}

function lineRuns(buckets, xAt, yOf) {
  const runs = []
  let run = []
  buckets.forEach((item, index) => {
    if (item.amount > 0) run.push({ x: xAt(index), y: yOf(item) })
    else if (run.length) {
      runs.push(run)
      run = []
    }
  })
  if (run.length) runs.push(run)
  return runs
}

function bucketPoints(points, from, to) {
  const byDate = new Map(points.map((point) => [point.date, point]))
  const days = []
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const point = byDate.get(day)
    days.push({ date: day, orders: point?.orders || 0, amount: point?.amount || 0 })
    if (days.length > 800) break
  }
  const span = days.length
  if (span <= 42) return days.map((item) => ({ ...item, label: shortDay(item.date), full: shortDay(item.date) }))
  if (span <= 140) return group(days, weekKey).map(decorate)
  return group(days, (item) => item.date.slice(0, 7)).map(decorate)
}

function group(days, keyOf) {
  const groups = []
  for (const day of days) {
    const key = keyOf(day)
    const last = groups[groups.length - 1]
    if (!last || last.date !== key) groups.push({ date: key, orders: 0, amount: 0 })
    const bucket = groups[groups.length - 1]
    bucket.orders += day.orders
    bucket.amount += day.amount
  }
  return groups
}

function decorate(bucket) {
  if (/^\d{4}-\d{2}$/.test(bucket.date)) {
    const { year, month } = parts(`${bucket.date}-01`)
    return { ...bucket, label: FULL_MONTHS[month - 1], full: `${FULL_MONTHS[month - 1]} ${year}` }
  }
  return { ...bucket, label: shortDay(bucket.date), full: `Week of ${fullDay(bucket.date)}` }
}

function weekKey(item) {
  const { year, month, day } = parts(item.date)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - date.getUTCDay())
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const MID_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const TINY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function monthWord(month, slot) {
  if (slot >= 60) return FULL_MONTHS[month - 1]
  if (slot >= 38) return MID_MONTHS[month - 1]
  return TINY_MONTHS[month - 1]
}

function tickIndexes(buckets, slot) {
  const monthly = /^\d{4}-\d{2}$/.test(buckets[0]?.date || "")
  if (monthly || slot >= 16) return buckets.map((_, index) => index)
  const step = Math.max(1, Math.ceil(16 / slot))
  const indexes = []
  for (let index = 0; index < buckets.length; index += step) indexes.push(index)
  if (indexes.at(-1) !== buckets.length - 1) indexes.push(buckets.length - 1)
  return indexes
}

function monthSpans(buckets) {
  const spans = []
  buckets.forEach((bucket, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bucket.date)) return
    const { month } = parts(bucket.date)
    const last = spans[spans.length - 1]
    if (!last || last.month !== month) spans.push({ month, start: index, end: index })
    else last.end = index
  })
  return spans
}

function shortDay(value) {
  const { month, day } = parts(value)
  return `${String(day).padStart(2, "0")} ${EN_MONTHS[month - 1]}`
}

function axisAmount(value) {
  return new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(Math.round(value))
}

function orderScaleOf(max) {
  const steps = 4
  const padded = Math.max(steps, Math.ceil(max * 1.25))
  return Math.ceil(padded / steps) * steps
}

function niceMax(value) {
  if (value <= 0) return 1
  const padded = value * 1.2
  const power = 10 ** Math.floor(Math.log10(padded))
  const unit = padded / power
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10
  return nice * power
}

function fullDay(value) {
  const { year, month, day } = parts(value)
  return `${day}/${month}/${year}`
}


