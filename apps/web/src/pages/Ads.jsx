import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { api } from "../api.js"
import DateRange from "../DateRange.jsx"
import { rangeFor, todayISO } from "../dates.js"
import { dayLabel, taka } from "../format.js"
import { Banner, Empty, Pager } from "../ui.jsx"

const PAGE_SIZES = [10, 20, 50, 100]

export function backText(back) {
  if (back == null) return ""
  return `Every ৳1 on ads brought ৳${back.toFixed(1)} in sales`
}

export function AdKpis({ totals }) {
  return (
    <div className="stock-kpis books-kpis ad-kpis">
      <div>
        <span>Spent on ads</span>
        <strong>{taka(totals.spend)}</strong>
      </div>
      <div>
        <span>Orders from ads</span>
        <strong>{totals.orders}</strong>
      </div>
      <div>
        <span>Cost per order</span>
        <strong>{totals.perOrder == null ? "—" : taka(totals.perOrder)}</strong>
      </div>
      <div>
        <span>Profit after ads</span>
        <strong className={totals.afterAds < 0 ? "bad" : "good"}>{taka(totals.afterAds)}</strong>
      </div>
    </div>
  )
}

export default function Ads() {
  const [range, setRange] = useState(() => rangeFor("30"))
  const [sources, setSources] = useState([])
  const [report, setReport] = useState(null)
  const [error, setError] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [editingId, setEditingId] = useState(null)
  const [spentOn, setSpentOn] = useState(todayISO)
  const [sourceId, setSourceId] = useState("")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    api("/api/sources")
      .then((body) => {
        if (!live) return
        setSources(body.sources)
        setSourceId((current) => current || String(body.sources[0]?.id || ""))
      })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [])

  function reportPath(nextPage = page) {
    const query = new URLSearchParams({
      from: range.from,
      to: range.to,
      limit: String(pageSize),
      offset: String((nextPage - 1) * pageSize),
    })
    return `/api/ads?${query}`
  }

  useEffect(() => {
    let live = true
    api(reportPath())
      .then((body) => {
        if (!live) return
        const pages = Math.max(1, Math.ceil(body.entryTotal / pageSize))
        if (page > pages) {
          setPage(pages)
          return
        }
        setReport(body)
      })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [range.from, range.to, page, pageSize])

  async function reload(nextPage = page) {
    setReport(await api(reportPath(nextPage)))
  }

  function clearForm() {
    setEditingId(null)
    setSpentOn(todayISO())
    setAmount("")
    setNote("")
  }

  function editRow(row) {
    setEditingId(row.id)
    setSpentOn(row.spentOn)
    setSourceId(String(row.sourceId))
    setAmount(String(row.amount))
    setNote(row.note || "")
    document.querySelector(".ad-form")?.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError("")
    const payload = { spentOn, sourceId: Number(sourceId), amount: Number(amount), note }
    const wasEditing = Boolean(editingId)
    try {
      if (wasEditing) await api(`/api/ads/${editingId}`, { method: "PATCH", body: payload })
      else await api("/api/ads", { method: "POST", body: payload })
      clearForm()
      if (!wasEditing) setPage(1)
      await reload(wasEditing ? page : 1)
      toast.success(wasEditing ? "Ad cost updated" : "Ad cost saved")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(row) {
    if (!window.confirm(`Remove the ${row.sourceName} ad cost of ${taka(row.amount)}?`)) return
    setError("")
    try {
      await api(`/api/ads/${row.id}`, { method: "DELETE" })
      if (editingId === row.id) clearForm()
      await reload()
      toast.success("Ad cost removed")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    }
  }

  const platforms = report?.platforms || []

  return (
    <section className="page books-page ads-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Paid ads</p>
          <h1>Ads</h1>
        </div>
      </div>
      <p className="lede">Write what each platform charged you every day. Orders are matched by the Source you pick on each order.</p>
      <div className="ads-range">
        <DateRange value={range} onChange={(next) => { setRange(next); setPage(1) }} />
      </div>
      <Banner message={error} />

      {report ? <AdKpis totals={report.totals} /> : <p className="muted">Loading…</p>}
      {report?.totals.back != null ? <p className="muted small ad-back">{backText(report.totals.back)}</p> : null}

      <div className="books-entry">
        <form className="card books-form ad-form" onSubmit={save}>
          <h2>{editingId ? "Edit this ad cost" : "Add ad cost"}</h2>
          <div className="books-line expense">
            <label className="field">
              <span>Date</span>
              <input type="date" value={spentOn} max={todayISO()} min="2020-01-01" onChange={(event) => setSpentOn(event.target.value)} required />
            </label>
            <label className="field">
              <span>Platform</span>
              <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} required>
                {sources.length === 0 ? <option value="">Add a source first</option> : null}
                {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Amount</span>
              <input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required />
            </label>
            <label className="field">
              <span>Note</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Campaign or post name" maxLength={160} />
            </label>
            <div className="form-actions wide">
              <button className="btn" type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Update" : "Save"}</button>
              {editingId ? <button className="btn secondary" type="button" onClick={clearForm}>Cancel</button> : null}
            </div>
          </div>
        </form>

        <article className="card ad-help">
          <h2>How to read this</h2>
          <ul>
            <li><b>Cost per order</b> is what you paid the platform for each order it brought.</li>
            <li><b>Profit after ads</b> is the order profit minus the ad cost. Red means the ads cost more than they earned.</li>
            <li>Cancelled and returned orders are left out.</li>
            <li>Pick the right Source on every order, or the numbers go to the wrong platform.</li>
          </ul>
        </article>
      </div>

      <article className="card">
        <div className="card-head">
          <h2>By platform</h2>
          <p className="muted small">Ads first, then the free ones</p>
        </div>
        {report && platforms.length === 0 ? <Empty title="Nothing in these dates" text="Add an ad cost, or pick other dates." /> : null}
        {platforms.length > 0 ? (
          <ul className="ad-platforms">
            {platforms.map((item) => (
              <li key={item.id ?? "none"} className={`ad-card${item.paid && item.afterAds < 0 ? " loss" : ""}`}>
                <div className="ad-card-head">
                  <strong>{item.name}</strong>
                  <span className={item.paid ? "ad-tag paid" : "ad-tag"}>{item.paid ? "Ads" : "No ads"}</span>
                </div>
                <dl>
                  <div><dt>Spent</dt><dd>{taka(item.spend)}</dd></div>
                  <div><dt>Orders</dt><dd>{item.orders}</dd></div>
                  <div><dt>Cost per order</dt><dd>{item.perOrder == null ? "—" : taka(item.perOrder)}</dd></div>
                  <div><dt>Sales</dt><dd>{taka(item.sales)}</dd></div>
                  <div><dt>Profit</dt><dd>{taka(item.profit)}</dd></div>
                  <div><dt>After ads</dt><dd className={item.afterAds < 0 ? "bad" : "good"}>{taka(item.afterAds)}</dd></div>
                </dl>
                {item.paid ? <p className="muted small">{item.orders ? backText(item.back) : "No orders yet from this spend"}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </article>

      <article className="card ad-list">
        <div className="card-head">
          <h2>Ad costs</h2>
          {report ? <p className="muted small">{report.entryTotal} {report.entryTotal === 1 ? "entry" : "entries"} · {taka(report.totals.spend)}</p> : null}
        </div>
        {report && report.entryTotal === 0 ? <p className="muted">No ad cost in these dates.</p> : null}
        {report?.entries.length ? (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Platform</th>
                  <th className="num">Amount</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report.entries.map((row) => (
                  <tr key={row.id} className={editingId === row.id ? "selected" : undefined}>
                    <td data-label="Date">{dayLabel(row.spentOn)}</td>
                    <td data-label="Platform"><strong>{row.sourceName}</strong></td>
                    <td data-label="Amount" className="num">{taka(row.amount)}</td>
                    <td data-label="Note">{row.note || "—"}</td>
                    <td data-label="">
                      <div className="row-actions">
                        <button type="button" className="text-btn" onClick={() => editRow(row)}>Edit</button>
                        <button type="button" className="text-btn danger" onClick={() => remove(row)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {report && report.entryTotal > 0 ? (
          <Pager
            page={page}
            total={report.entryTotal}
            pageSize={pageSize}
            pageSizes={PAGE_SIZES}
            onPage={(next) => {
              setPage(next)
              document.querySelector(".ad-list")?.scrollIntoView({ block: "start", behavior: "smooth" })
            }}
            onPageSize={(next) => { setPageSize(next); setPage(1) }}
          />
        ) : null}
      </article>
    </section>
  )
}
