import { useEffect, useState } from "react"
import { STATUSES, statusLabel } from "@rose/shared"
import { api } from "../api.js"
import { ShareDonut, SourceChart, StockMix, TrendChart } from "../charts.jsx"
import DateRange from "../DateRange.jsx"
import { rangeFor } from "../dates.js"
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
    <section className="page dash">
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

function useStats(range) {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    setLoading(true)
    setError("")
    const query = new URLSearchParams({ from: range.from, to: range.to })
    api(`/api/stats?${query}`)
      .then((body) => { if (live) setStats(body) })
      .catch((reason) => { if (live) setError(reason.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [range.from, range.to])
  const current = stats && stats.from === range.from && stats.to === range.to ? stats : null
  return { stats: current, error, loading }
}

function ChartSlot({ stats, loading, error, children }) {
  if (loading || !stats) return error && !loading ? null : <p className="muted load-line">লোড হচ্ছে…</p>
  return children(stats)
}

function Board({ data, go }) {
  const [trendRange, setTrendRange] = useState(() => rangeFor("30"))
  const [sourceRange, setSourceRange] = useState(() => rangeFor("30"))
  const [statusRange, setStatusRange] = useState(() => rangeFor("month"))
  const trend = useStats(trendRange)
  const sources = useStats(sourceRange)
  const statuses = useStats(statusRange)
  const openCount = data.open.new + data.open.confirmed + data.open.courier
  return (
    <>
      <div className="stats">
        <Stat kicker="আজ" label="বিক্রি" value={taka(data.today.sales)} note={`${data.today.orders}টা অর্ডার · ডেলিভারি ${taka(data.today.delivery)}`} />
        <Stat kicker="আজ" label="লাভ" value={taka(data.today.profit)} note="বিক্রি থেকে কেনার দাম আর আপনার ডেলিভারি বাদ" />
        <Stat kicker="এই মাস" label="বিক্রি" value={taka(data.month.sales)} note={`${data.month.orders}টা অর্ডার`} />
        <Stat kicker="এই মাস" label="লাভ" value={taka(data.month.profit)} note={`বাকি আদায় ${taka(data.dueAll)}`} />
      </div>

      <article className="card dash-block">
        <div className="card-head">
          <div>
            <h2>অর্ডারের ধারা</h2>
            <p className="muted small">বাতিল ও রিটার্ন বাদ</p>
          </div>
          <DateRange value={trendRange} onChange={setTrendRange} />
        </div>
        <Banner message={trend.loading ? "" : trend.error} />
        <ChartSlot stats={trend.stats} loading={trend.loading} error={trend.error}>
          {(stats) => (
            <>
              <div className="trend-kpis">
                <span>অর্ডার <b>{stats.orders}</b></span>
                <span>বিক্রি <b>{taka(stats.amount)}</b></span>
              </div>
              <TrendChart points={stats.points} from={trendRange.from} to={trendRange.to} />
            </>
          )}
        </ChartSlot>
      </article>

      <div className="split">
        <article className="card">
          <div className="card-head">
            <div>
              <h2>সোর্স</h2>
              <p className="muted small">কোন জায়গা থেকে কত অর্ডার</p>
            </div>
            <DateRange value={sourceRange} onChange={setSourceRange} />
          </div>
          <Banner message={sources.loading ? "" : sources.error} />
          <ChartSlot stats={sources.stats} loading={sources.loading} error={sources.error}>
            {(stats) => <SourceChart sources={stats.sources} />}
          </ChartSlot>
        </article>
        <article className="card">
          <div className="card-head">
            <div>
              <h2>স্ট্যাটাস</h2>
              <p className="muted small">{openCount}টা এখনো খোলা</p>
            </div>
            <DateRange value={statusRange} onChange={setStatusRange} />
          </div>
          <Banner message={statuses.loading ? "" : statuses.error} />
          <ChartSlot stats={statuses.stats} loading={statuses.loading} error={statuses.error}>
            {(stats) => <StatusChart counts={stats.statuses} />}
          </ChartSlot>
        </article>
      </div>

      <article className="card stock-band">
        <div className="card-head">
          <h2>স্টক</h2>
          <button type="button" className="text-btn" onClick={() => go("/inventory")}>ইনভেন্টরি</button>
        </div>
        <div className="stock-kpis">
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
          <div>
            <span>সম্ভাব্য লাভ</span>
            <strong>{taka(data.inventory.sellValue - data.inventory.costValue)}</strong>
          </div>
        </div>
        <div className="stock-body">
          <StockMix cost={data.inventory.costValue} sell={data.inventory.sellValue} />
          <div className="stock-cols">
            <div>
              <h3>কম আছে</h3>
              {data.inventory.low.length === 0 ? (
                <p className="muted small">{data.inventory.lowAt} বা কম নেই।</p>
              ) : (
                <ul className="stock-list">
                  {data.inventory.low.map((item) => (
                    <li key={item.id}>
                      <span>{item.name}</span>
                      <b className={item.stockQty === 0 ? "bad" : "warn"}>{item.stockQty}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>কম্বো</h3>
              {data.inventory.combos.length === 0 ? <p className="muted small">কম্বো নেই।</p> : (
                <ul className="stock-list">
                  {data.inventory.combos.map((item) => (
                    <li key={item.id}>
                      <span>{item.name}</span>
                      <b className={item.available === 0 ? "bad" : ""}>{item.available} সেট</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </article>

      <article className="card">
        <div className="card-head">
          <h2>সাম্প্রতিক অর্ডার <span className="muted small">শেষ ১০টা</span></h2>
          <button type="button" className="text-btn" onClick={() => go("/orders")}>সব দেখুন</button>
        </div>
        {data.recent.length === 0 ? (
          <Empty title="এখনো অর্ডার নেই" text="প্রথম অর্ডার দিলে এখানে হিসাব দেখা যাবে।" />
        ) : (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>অর্ডার</th>
                  <th>কাস্টমার</th>
                  <th>সোর্স</th>
                  <th>সময়</th>
                  <th>স্ট্যাটাস</th>
                  <th>মোট</th>
                  <th>বাকি</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((order) => (
                  <tr key={order.id} onClick={() => go(`/orders/${order.id}`)}>
                    <td data-label="অর্ডার"><strong>{order.number}</strong></td>
                    <td data-label="কাস্টমার">
                      {order.customerName}
                      <small>{order.mobile}<br />{order.courier}</small>
                    </td>
                    <td data-label="সোর্স">{order.sourceName || "—"}</td>
                    <td data-label="সময়">{when(order.orderedAt)}</td>
                    <td data-label="স্ট্যাটাস"><StatusPill status={order.status} /></td>
                    <td data-label="মোট">{taka(order.total)}</td>
                    <td data-label="বাকি" className={order.due > 0 ? "danger" : ""}>{taka(order.due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function StatusChart({ counts }) {
  const slices = STATUSES.map((status) => ({ id: status.id, name: status.label, value: counts[status.id] || 0, color: status.color }))
  const total = slices.reduce((sum, item) => sum + item.value, 0)
  if (!total) return <p className="muted chart-empty">এই সময়ে কোনো অর্ডার নেই।</p>
  return (
    <div className="chart">
      <ShareDonut slices={slices} label="অর্ডার" />
      <ul className="status-key">
        {slices.map((status) => (
          <li key={status.id}>
            <i style={{ background: status.color }} />
            <span>{statusLabel(status.id)}</span>
            <b>{status.value}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}
