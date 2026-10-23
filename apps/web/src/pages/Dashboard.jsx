import { useEffect, useState } from "react"
import { STATUSES, statusLabel } from "@rose/shared"
import { api } from "../api.js"
import { taka, when } from "../format.js"
import { useRoute } from "../route.jsx"
import { Banner, Empty, StatusPill } from "../ui.jsx"

export default function Dashboard() {
  const { go } = useRoute()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let live = true
    api("/api/dashboard")
      .then((body) => { if (live) setData(body) })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [])

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">আজকের খাতা</p>
          <h1>ড্যাশবোর্ড</h1>
        </div>
        <button type="button" className="btn" onClick={() => go("/orders/new")}>নতুন অর্ডার</button>
      </div>
      <Banner message={error} />
      {!data && !error ? <p className="muted">লোড হচ্ছে…</p> : null}
      {data ? <Board data={data} go={go} /> : null}
    </section>
  )
}

function Board({ data, go }) {
  const openCount = data.open.new + data.open.confirmed + data.open.courier
  return (
    <>
      <div className="stats">
        <Stat kicker="আজ" label="বিক্রি" value={taka(data.today.sales)} note={`${data.today.orders}টা অর্ডার · ডেলিভারি ${taka(data.today.delivery)}`} />
        <Stat kicker="আজ" label="লাভ" value={taka(data.today.profit)} note="বিক্রি থেকে কেনার দাম আর আপনার ডেলিভারি বাদ" />
        <Stat kicker="এই মাস" label="বিক্রি" value={taka(data.month.sales)} note={`${data.month.orders}টা অর্ডার`} />
        <Stat kicker="এই মাস" label="লাভ" value={taka(data.month.profit)} note={`বাকি আদায় ${taka(data.dueAll)}`} />
      </div>

      <div className="split">
        <article className="card">
          <div className="card-head">
            <h2>এই মাসের অর্ডার</h2>
            <span className="muted">{openCount}টা এখনো খোলা</span>
          </div>
          <StatusChart counts={data.monthStatuses} />
          <div className="open-row">
            <OpenChip label="নতুন" value={data.open.new} />
            <OpenChip label="কনফার্ম" value={data.open.confirmed} />
            <OpenChip label="কুরিয়ারে" value={data.open.courier} />
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <h2>স্টকের অবস্থা</h2>
            <button type="button" className="text-btn" onClick={() => go("/inventory")}>ইনভেন্টরি</button>
          </div>
          <div className="stock-metrics">
            <div>
              <span>মোট পিস</span>
              <strong>{data.inventory.pieces}</strong>
            </div>
            <div>
              <span>কেনা দামে</span>
              <strong>{taka(data.inventory.costValue)}</strong>
            </div>
            <div>
              <span>বিক্রি হলে</span>
              <strong>{taka(data.inventory.sellValue)}</strong>
            </div>
          </div>
          <h3>কম আছে</h3>
          {data.inventory.low.length === 0 ? (
            <p className="muted">{data.inventory.lowAt} পিস বা তার কম এমন কোনো মাল নেই।</p>
          ) : (
            <ul className="plain-list">
              {data.inventory.low.map((item) => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  <b className={item.stockQty === 0 ? "danger" : "warn"}>{item.stockQty} পিস</b>
                </li>
              ))}
            </ul>
          )}
          <h3>কম্বো</h3>
          {data.inventory.combos.length === 0 ? <p className="muted">এখনো কোনো কম্বো নেই।</p> : (
            <ul className="plain-list">
              {data.inventory.combos.map((item) => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  <b className={item.available === 0 ? "danger" : ""}>{item.available} সেট</b>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <article className="card">
        <div className="card-head">
          <h2>সাম্প্রতিক অর্ডার <span className="muted small">শেষ ১০টা</span></h2>
          <button type="button" className="text-btn" onClick={() => go("/orders")}>সব দেখুন</button>
        </div>
        {data.recent.length === 0 ? (
          <Empty title="এখনো অর্ডার নেই" text="প্রথম অর্ডার দিলে এখানে হিসাব দেখা যাবে।" />
        ) : (
          <ul className="recent">
            {data.recent.map((order) => (
              <li key={order.id}>
                <button type="button" onClick={() => go(`/orders/${order.id}`)}>
                  <span>
                    <strong>{order.number}</strong>
                    <small>{order.customerName} · {when(order.orderedAt)}</small>
                  </span>
                  <StatusPill status={order.status} />
                  <b>{taka(order.total)}</b>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
    </>
  )
}

function Stat({ kicker, label, value, note }) {
  return (
    <article className="stat">
      <span>{kicker}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function OpenChip({ label, value }) {
  return (
    <div className="chip">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

function StatusChart({ counts }) {
  const slices = STATUSES.map((status) => ({ ...status, value: counts[status.id] || 0 })).filter((item) => item.value > 0)
  const total = slices.reduce((sum, item) => sum + item.value, 0)
  const radius = 68
  const circ = 2 * Math.PI * radius
  let offset = 0
  const segments = slices.map((slice) => {
    const length = total ? (slice.value / total) * circ : 0
    const segment = { ...slice, length, offset }
    offset += length
    return segment
  })

  if (!total) {
    return <p className="muted chart-empty">এই মাসে এখনো কোনো অর্ডার আসেনি।</p>
  }

  return (
    <div className="chart">
      <svg viewBox="0 0 180 180" role="img" aria-label="এই মাসের অর্ডার স্ট্যাটাস">
        <circle className="chart-track" cx="90" cy="90" r={radius} fill="none" strokeWidth="18" />
        {segments.map((segment) => (
          <circle
            key={segment.id}
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth="18"
            strokeDasharray={`${segment.length} ${circ - segment.length}`}
            strokeDashoffset={-segment.offset}
            transform="rotate(-90 90 90)"
          />
        ))}
        <text x="90" y="86" textAnchor="middle" className="chart-total">{total}</text>
        <text x="90" y="108" textAnchor="middle" className="chart-caption">অর্ডার</text>
      </svg>
      <ul>
        {STATUSES.map((status) => (
          <li key={status.id}>
            <i style={{ background: status.color }} />
            <span>{statusLabel(status.id)}</span>
            <b>{counts[status.id] || 0}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}
