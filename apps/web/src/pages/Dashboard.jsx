import { useEffect, useState } from "react"
import { STATUSES, statusLabel } from "@rose/shared"
import { api } from "../api.js"
import { AdPlatformBars, AdTrend, BooksMix, ShareDonut, SourceChart, StockMix, TrendChart } from "../charts.jsx"
import DateRange from "../DateRange.jsx"
import { rangeFor } from "../dates.js"
import { taka } from "../format.js"
import { useRoute } from "../route.jsx"
import { Banner, Pager } from "../ui.jsx"
import { AdKpis, backText } from "./Ads.jsx"

const SHORT_PAGE = 6

function ShortList({ items, render }) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(items.length / SHORT_PAGE))
  const current = Math.min(page, pages)
  const shown = items.slice((current - 1) * SHORT_PAGE, current * SHORT_PAGE)
  return (
    <>
      <ul className="stock-list">{shown.map(render)}</ul>
      <Pager page={current} total={items.length} pageSize={SHORT_PAGE} onPage={setPage} />
    </>
  )
}

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

function useAds(range) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState("")
  useEffect(() => {
    let live = true
    setError("")
    const query = new URLSearchParams({ from: range.from, to: range.to, limit: "1" })
    api(`/api/ads?${query}`)
      .then((body) => { if (live) setReport(body) })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [range.from, range.to])
  const current = report && report.from === range.from && report.to === range.to ? report : null
  return { report: current, error }
}

function AdsBlock({ go }) {
  const [range, setRange] = useState(() => rangeFor("month"))
  const { report, error } = useAds(range)
  const paid = report?.platforms.filter((item) => item.paid) || []
  return (
    <article className="card dash-block ads-block">
      <div className="card-head">
        <div>
          <h2>Ads</h2>
          <p className="muted small">What the ads cost and what they brought</p>
        </div>
        <div className="ads-block-actions">
          <DateRange value={range} onChange={setRange} />
          <button type="button" className="text-btn" onClick={() => go("/ads")}>Open ads</button>
        </div>
      </div>
      <Banner message={error} />
      {!report && !error ? <p className="muted load-line">Loading…</p> : null}
      {report && report.totals.spend === 0 ? (
        <p className="muted small">No ad cost in these dates. Add one on the Ads page to see cost per order and profit after ads.</p>
      ) : null}
      {report && report.totals.spend > 0 ? (
        <>
          <AdKpis totals={report.totals} />
          {report.totals.back != null ? <p className="muted small ad-back">{backText(report.totals.back)}</p> : null}
          <div className="ad-charts">
            <div>
              <h3>Spent and sales by day</h3>
              <div className="trend-kpis">
                <span><i className="spend" />Ad cost</span>
                <span><i className="line" />Sales from ad platforms</span>
              </div>
              <AdTrend days={report.days} from={range.from} to={range.to} />
            </div>
            <div>
              <h3>Each platform</h3>
              <p className="muted small">{paid.length} with ads · red is a loss</p>
              <AdPlatformBars platforms={report.platforms} />
            </div>
          </div>
        </>
      ) : null}
    </article>
  )
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
        <Stat kicker="Today" label="Net profit" value={taka(data.today.net)} note={netNote(data.today)} tone={data.today.net < 0 ? "bad" : ""} />
        <Stat kicker="This month" label="Sales" value={taka(data.month.sales)} note={`${data.month.orders} orders · due ${taka(data.dueAll)}`} />
        <Stat kicker="This month" label="Net profit" value={taka(data.month.net)} note={netNote(data.month)} tone={data.month.net < 0 ? "bad" : ""} />
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
                <span><i className="bar" />Orders <b>{stats.orders}</b></span>
                <span><i className="line" />Sales <b>{taka(stats.amount)}</b></span>
                <span><i className="courier" />Courier <b>{stats.courier ?? 0}</b></span>
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

      <AdsBlock go={go} />

      <div className="chart-pair">
        <article className="card stock-band pair-card">
          <div className="card-head">
            <h2>Stock</h2>
            <button type="button" className="text-btn" onClick={() => go("/inventory")}>Inventory</button>
          </div>
          <div className="pair-body">
            <StockMix cost={data.inventory.costValue} sell={data.inventory.sellValue} />
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
          </div>
        </article>
        <article className="card stock-band pair-card">
          <div className="card-head">
            <div>
              <h2>Books</h2>
              <p className="muted small">Goods, vehicle, courier, and other costs</p>
            </div>
            <button type="button" className="text-btn" onClick={() => go("/purchases")}>Open books</button>
          </div>
          <div className="pair-body">
            <BooksMix goods={data.books.goods} vehicle={data.books.vehicle} courier={data.books.courier} other={data.books.other} />
            <div className="stock-kpis">
              <div>
                <span>Goods</span>
                <strong>{taka(data.books.goods)}</strong>
              </div>
              <div>
                <span>Bringing in</span>
                <strong>{taka(data.books.expenses)}</strong>
              </div>
              <div>
                <span>Sold</span>
                <strong>{taka(data.books.sales)}</strong>
              </div>
              <div>
                <span>Profit</span>
                <strong>{taka(data.books.profit)}</strong>
                {data.books.ads > 0 ? <small className="muted">Ads {taka(data.books.ads)} taken out</small> : null}
              </div>
            </div>
          </div>
        </article>
      </div>

      <StockAlerts inventory={data.inventory} go={go} />
    </>
  )
}

function StockAlerts({ inventory, go }) {
  const { low, combos, lowAt } = inventory
  const out = low.filter((item) => item.stockQty === 0).length
  const comboOut = combos.filter((item) => item.available === 0).length
  const summary = low.length === 0 && comboOut === 0
    ? "All stock looks fine"
    : [out ? `${out} out of stock` : "", low.length - out ? `${low.length - out} running low` : "", comboOut ? `${comboOut} combo${comboOut === 1 ? "" : "s"} cannot be made` : ""].filter(Boolean).join(" · ")
  return (
    <article className="card stock-alerts">
      <div className="card-head">
        <div>
          <h2>Stock alerts</h2>
          <p className="muted small">{summary}</p>
        </div>
        <button type="button" className="text-btn" onClick={() => go("/inventory")}>Inventory</button>
      </div>
      <div className="alert-cols">
        <section>
          <h3>Running low <span className="alert-count">{low.length}</span></h3>
          <p className="muted small">Products with {lowAt} or fewer pieces left</p>
          {low.length === 0 ? <p className="alert-ok">Nothing is running low.</p> : (
            <ShortList
              items={low}
              render={(item) => (
                <li key={item.id} className="alert-row">
                  <div className="alert-name">
                    <span>{item.name}</span>
                    <div className="bar-track"><div className={`bar-fill ${item.stockQty === 0 ? "loss" : "warn"}`} style={{ width: `${Math.max(4, (item.stockQty / (lowAt * 2)) * 100)}%` }} /></div>
                  </div>
                  <b className={item.stockQty === 0 ? "alert-pill bad" : "alert-pill warn"}>{item.stockQty === 0 ? "Out" : `${item.stockQty} left`}</b>
                </li>
              )}
            />
          )}
        </section>
        <section>
          <h3>Combos <span className="alert-count">{combos.length}</span></h3>
          <p className="muted small">Sets you can make from the pieces in stock</p>
          {combos.length === 0 ? <p className="muted small">No combos yet.</p> : (
            <ShortList
              items={combos}
              render={(item) => (
                <li key={item.id} className="alert-row">
                  <div className="alert-name">
                    <span>{item.name}</span>
                    {item.heldBy && item.available <= lowAt ? <small className="muted">Short on {item.heldBy}</small> : null}
                  </div>
                  <b className={`alert-pill ${item.available === 0 ? "bad" : item.available <= lowAt ? "warn" : "ok"}`}>{item.available === 0 ? "None" : `${item.available} ${item.available === 1 ? "set" : "sets"}`}</b>
                </li>
              )}
            />
          )}
        </section>
      </div>
    </article>
  )
}

function netNote(period) {
  return `Orders ${taka(period.profit)} − ads ${taka(period.ads)} − costs ${taka(period.expenses)}`
}

function Stat({ kicker, label, value, note, tone = "" }) {
  return (
    <article className="stat">
      <span>{kicker}</span>
      <p>{label}</p>
      <strong className={tone}>{value}</strong>
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
