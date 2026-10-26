import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { api } from "../api.js"
import DateRange from "../DateRange.jsx"
import { todayISO } from "../dates.js"
import { dayLabel, taka } from "../format.js"
import { Empty, Pager } from "../ui.jsx"

const PAGE_SIZES = [10, 20, 50, 100, 200]
export const REASONS = [
  { id: "personal", label: "Personal" },
  { id: "family", label: "Family" },
  { id: "home", label: "Home and bills" },
  { id: "loan", label: "Loan or EMI" },
  { id: "savings", label: "Savings" },
  { id: "other", label: "Other" },
]

function reasonLabel(id) {
  return REASONS.find((item) => item.id === id)?.label || id
}

export default function Withdrawals({ profit }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [range, setRange] = useState(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [takenOn, setTakenOn] = useState(todayISO)
  const [reason, setReason] = useState("personal")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  function query(nextPage = page) {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String((nextPage - 1) * pageSize) })
    if (range?.from && range?.to) {
      params.set("from", range.from)
      params.set("to", range.to)
    }
    return params
  }

  useEffect(() => {
    let live = true
    api(`/api/withdrawals?${query()}`)
      .then((body) => {
        if (!live) return
        const pages = Math.max(1, Math.ceil(body.total / pageSize))
        if (page > pages) {
          setPage(pages)
          return
        }
        setData(body)
      })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [page, pageSize, range])

  async function reload(nextPage = page) {
    setData(await api(`/api/withdrawals?${query(nextPage)}`))
  }

  function clearForm() {
    setEditingId(null)
    setTakenOn(todayISO())
    setReason("personal")
    setAmount("")
    setNote("")
  }

  function edit(row) {
    setEditingId(row.id)
    setTakenOn(row.takenOn)
    setReason(row.reason)
    setAmount(String(row.amount))
    setNote(row.note || "")
    document.querySelector(".withdraw-form")?.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError("")
    const payload = { takenOn, reason, amount: Number(amount), note }
    const wasEditing = Boolean(editingId)
    try {
      if (wasEditing) await api(`/api/withdrawals/${editingId}`, { method: "PATCH", body: payload })
      else await api("/api/withdrawals", { method: "POST", body: payload })
      clearForm()
      if (!wasEditing) setPage(1)
      await reload(wasEditing ? page : 1)
      toast.success(wasEditing ? "Withdrawal updated" : "Withdrawal saved")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(row) {
    if (!window.confirm(`Remove this withdrawal of ${taka(row.amount)}?`)) return
    setError("")
    try {
      await api(`/api/withdrawals/${row.id}`, { method: "DELETE" })
      if (editingId === row.id) clearForm()
      await reload()
      toast.success("Withdrawal removed")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    }
  }

  const totals = data?.totals || { all: 0, month: 0 }
  const left = profit - totals.all
  const top = Math.max(1, ...(data?.reasons || []).map((item) => item.amount))

  return (
    <article className="card withdraw-card">
      <div className="card-head">
        <div>
          <h2>Money you took out</h2>
          <p className="muted small">Your own money from the business. Profit stays as it is, and this shows how much of it is still in the business.</p>
        </div>
      </div>
      {error ? <p className="banner banner-bad">{error}</p> : null}

      <div className="stock-kpis withdraw-kpis">
        <div>
          <span>This month</span>
          <strong>{taka(totals.month)}</strong>
        </div>
        <div>
          <span>All time</span>
          <strong>{taka(totals.all)}</strong>
        </div>
        <div>
          <span>Profit</span>
          <strong>{taka(profit)}</strong>
        </div>
        <div>
          <span>Left in business</span>
          <strong className={left < 0 ? "bad" : "good"}>{taka(left)}</strong>
          <small className="muted">Profit − all you took</small>
        </div>
      </div>

      <form className="books-line withdraw-form" onSubmit={save}>
        <label className="field">
          <span>Date</span>
          <input type="date" value={takenOn} max={todayISO()} min="2020-01-01" onChange={(event) => setTakenOn(event.target.value)} required />
        </label>
        <label className="field">
          <span>Why</span>
          <select value={reason} onChange={(event) => setReason(event.target.value)}>
            {REASONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Amount</span>
          <input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="What it was for" maxLength={160} />
        </label>
        <div className="form-actions">
          <button className="btn" type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Update" : "Save"}</button>
          {editingId ? <button className="btn secondary" type="button" onClick={clearForm}>Cancel</button> : null}
        </div>
      </form>

      <div className="withdraw-head">
        <h3>{range ? "In these dates" : "Every withdrawal"}</h3>
        <DateRange allowAll value={range} onChange={(next) => { setRange(next); setPage(1) }} />
      </div>

      {!data && !error ? <p className="muted">Loading…</p> : null}
      {data && data.total === 0 ? (
        <Empty title={range ? "Nothing in these dates" : "Nothing taken out yet"} text="Save the money you take from the business and it will show here." />
      ) : null}
      {data && data.total > 0 ? (
        <div className="withdraw-body">
          <section className="withdraw-reasons">
            <p className="muted small">{data.total} {data.total === 1 ? "time" : "times"} · {taka(data.amount)}</p>
            <ul className="reason-bars">
              {data.reasons.map((item) => (
                <li key={item.reason}>
                  <div className="reason-head">
                    <b>{reasonLabel(item.reason)}</b>
                    <small className="muted">{item.times} {item.times === 1 ? "time" : "times"}</small>
                  </div>
                  <div className="withdraw-bar">
                    <div className="bar-track"><div className="bar-fill spend" style={{ width: `${Math.max(4, (item.amount / top) * 100)}%` }} /></div>
                    <b>{taka(item.amount)}</b>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="withdraw-list">
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Why</th>
                    <th className="num">Amount</th>
                    <th>Note</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.withdrawals.map((row) => (
                    <tr key={row.id} className={editingId === row.id ? "selected" : undefined}>
                      <td data-label="Date">{dayLabel(row.takenOn)}</td>
                      <td data-label="Why"><strong>{reasonLabel(row.reason)}</strong></td>
                      <td data-label="Amount" className="num">{taka(row.amount)}</td>
                      <td data-label="Note">{row.note || "—"}</td>
                      <td data-label="">
                        <div className="row-actions">
                          <button type="button" className="text-btn" onClick={() => edit(row)}>Edit</button>
                          <button type="button" className="text-btn danger" onClick={() => remove(row)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={page}
              total={data.total}
              pageSize={pageSize}
              pageSizes={PAGE_SIZES}
              onPage={(next) => {
                setPage(next)
                document.querySelector(".withdraw-head")?.scrollIntoView({ block: "start", behavior: "smooth" })
              }}
              onPageSize={(next) => { setPageSize(next); setPage(1) }}
            />
          </section>
        </div>
      ) : null}
    </article>
  )
}
