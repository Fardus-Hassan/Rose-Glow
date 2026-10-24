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
          <p className="eyebrow">Today's books</p>
          <h1>Dashboard</h1>
        </div>
        <button type="button" className="btn" onClick={() => go("/orders/new")}>New order</button>
      </div>
      <Banner message={error} />
      {!data && !error ? <p className="muted">Loading…</p> : null}
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
  if (loading || !stats) return error && !loading ? null : <p className="muted load-line">Loading…</p>
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
        <Stat kicker="Today" label="Sales" value={taka(data.today.sales)} note={`${data.today.orders} orders · delivery ${taka(data.today.delivery)}`} />
        <Stat kicker="Today" label="Profit" value={taka(data.today.profit)} note="Sales minus cost and the delivery you pay" />
        <Stat kicker="This month" label="Sales" value={taka(data.month.sales)} note={`${data.month.orders} orders`} />
        <Stat kicker="This month" label="Profit" value={taka(data.month.profit)} note={`Due to collect ${taka(data.dueAll)}`} />
      </div>

      <article className="card dash-block">
        <div className="card-head">
          <div>
            <h2>Order trend</h2>
            <p className="muted small">Cancelled and returned left out</p>
          </div>
          <DateRange value={trendRange} onChange={setTrendRange} />
        </div>
        <Banner message={trend.loading ? "" : trend.error} />
        <ChartSlot stats={trend.stats} loading={trend.loading} error={trend.error}>
          {(stats) => (
            <>
              <div className="trend-kpis">
                <span>Orders <b>{stats.orders}</b></span>
                <span>Sales <b>{taka(stats.amount)}</b></span>
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
              <h2>Sources</h2>
              <p className="muted small">How many orders came from each place</p>
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
              <h2>Status</h2>
              <p className="muted small">{openCount} still open</p>
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
          <h2>Stock</h2>
          <button type="button" className="text-btn" onClick={() => go("/inventory")}>Inventory</button>
        </div>
        <div className="stock-kpis">
          <div>
            <span>Total pieces</span>
            <strong>{data.inventory.pieces}</strong>
          </div>
          <div>
            <span>At cost</span>
            <strong>{taka(data.inventory.costValue)}</strong>
          </div>
          <div>
            <span>If sold</span>
            <strong>{taka(data.inventory.sellValue)}</strong>
          </div>
          <div>
            <span>Possible profit</span>
            <strong>{taka(data.inventory.sellValue - data.inventory.costValue)}</strong>
          </div>
        </div>
        <div className="stock-body">
          <StockMix cost={data.inventory.costValue} sell={data.inventory.sellValue} />
          <div className="stock-cols">
            <div>
              <h3>Running low</h3>
              {data.inventory.low.length === 0 ? (
                <p className="muted small">Nothing at {data.inventory.lowAt} or below.</p>
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
              <h3>Combos</h3>
              {data.inventory.combos.length === 0 ? <p className="muted small">No combos.</p> : (
                <ul className="stock-list">
                  {data.inventory.combos.map((item) => (
                    <li key={item.id}>
                      <span>{item.name}</span>
                      <b className={item.available === 0 ? "bad" : ""}>{item.available} sets</b>
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
          <h2>Recent orders <span className="muted small">Last 10</span></h2>
          <button type="button" className="text-btn" onClick={() => go("/orders")}>See all</button>
        </div>
        {data.recent.length === 0 ? (
          <Empty title="No orders yet" text="The first order will show up here." />
        ) : (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Source</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((order) => (
                  <tr key={order.id} onClick={() => go(`/orders/${order.id}`)}>
                    <td data-label="Order"><strong>{order.number}</strong></td>
                    <td data-label="Customer">
                      {order.customerName}
                      <small>{order.mobile}<br />{order.courier}</small>
                    </td>
                    <td data-label="Source">{order.sourceName || "—"}</td>
                    <td data-label="Time">{when(order.orderedAt)}</td>
                    <td data-label="Status"><StatusPill status={order.status} /></td>
                    <td data-label="Total">{taka(order.total)}</td>
                    <td data-label="Due" className={order.due > 0 ? "danger" : ""}>{taka(order.due)}</td>
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
  if (!total) return <p className="muted chart-empty">No orders in this period.</p>
  return (
    <div className="chart">
      <ShareDonut slices={slices} label="Orders" />
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
