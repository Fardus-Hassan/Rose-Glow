import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { COURIER_STATUSES, courierStatusLabel, statusLabel } from "@rose/shared"
import { api } from "../api.js"
import { taka, when } from "../format.js"
import { useRoute } from "../route.jsx"
import { Banner, CopyText, Pager } from "../ui.jsx"

const PAGE_SIZES = [10, 20, 50, 100, 200]

export default function Courier() {
  const { go } = useRoute()
  const [account, setAccount] = useState(null)
  const [parcels, setParcels] = useState([])
  const [parcelTotal, setParcelTotal] = useState(0)
  const [parcelPage, setParcelPage] = useState(1)
  const [parcelPageSize, setParcelPageSize] = useState(10)
  const [parcelsReady, setParcelsReady] = useState(false)
  const [parcelTick, setParcelTick] = useState(0)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [secretKey, setSecretKey] = useState("")
  const [webhookToken, setWebhookToken] = useState("")
  const [hidden, setHidden] = useState(null)
  const [extra, setExtra] = useState([])
  const [savingFilters, setSavingFilters] = useState(false)

  function applyAccount(next) {
    setAccount(next)
    setWebhookToken(next.webhookToken || "")
  }

  useEffect(() => {
    let live = true
    Promise.all([api("/api/courier/account"), api("/api/courier/filters")])
      .then(([next, filters]) => {
        if (!live) return
        applyAccount(next)
        setHidden(new Set(filters.hidden || []))
        setExtra(filters.extra || [])
      })
      .catch((reason) => {
        if (live) setError(reason.message)
      })
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    const query = new URLSearchParams({
      limit: String(parcelPageSize),
      offset: String((parcelPage - 1) * parcelPageSize),
    })
    api(`/api/courier/parcels?${query}`)
      .then((body) => {
        if (!live) return
        const pages = Math.max(1, Math.ceil(body.total / parcelPageSize))
        if (parcelPage > pages) {
          setParcelPage(pages)
          return
        }
        setParcels(body.parcels)
        setParcelTotal(body.total)
        setParcelsReady(true)
      })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [parcelPage, parcelPageSize, parcelTick])

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError("")
    try {
      const next = await api("/api/courier/account", {
        method: "PUT",
        body: { apiKey, secretKey, webhookToken },
      })
      applyAccount(next)
      setApiKey("")
      setSecretKey("")
      setParcelPage(1)
      setParcelTick((tick) => tick + 1)
      toast.success("Steadfast connected")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function refresh() {
    setSaving(true)
    setError("")
    try {
      const body = await api("/api/courier/balance", { method: "POST", body: {} })
      setAccount((current) => ({ ...current, balance: body.balance, checkedAt: body.checkedAt }))
      toast.success("Balance updated")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    setSaving(true)
    setError("")
    try {
      const next = await api("/api/courier/account", { method: "DELETE" })
      applyAccount(next)
      setWebhookToken("")
      toast.success("Steadfast disconnected")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  function toggleFilter(id) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function saveFilters() {
    setSavingFilters(true)
    setError("")
    try {
      const body = await api("/api/courier/filters", {
        method: "PUT",
        body: { hidden: [...hidden] },
      })
      setHidden(new Set(body.hidden || []))
      setExtra(body.extra || [])
      toast.success("Filter list saved")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSavingFilters(false)
    }
  }

  const filterStatuses = [
    ...Object.entries(COURIER_STATUSES).map(([id, label]) => ({ id, label })),
    ...extra.filter((id) => !COURIER_STATUSES[id]).map((id) => ({ id, label: courierStatusLabel(id) })),
  ]
  const shown = hidden ? filterStatuses.filter((item) => !hidden.has(item.id)).length : 0

  return (
    <section className="page courier-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Courier</p>
          <h1>Steadfast</h1>
        </div>
      </div>
      <p className="lede">Add the keys and a parcel is booked when an order is marked In courier. Status changes show up in the bell. Steadfast has no test mode, so this is a real parcel.</p>
      <Banner message={error} />

      <div className="split">
        <form className="card stack tight" onSubmit={save}>
          <h2>{account?.connected ? "Change keys" : "Credentials"}</h2>
          {account?.connected ? <p className="muted">Saved key ends in {account.keyHint}. A new key replaces the old one.</p> : null}
          <label className="field">
            <span>API Key</span>
            <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck="false" required />
          </label>
          <label className="field">
            <span>Secret Key</span>
            <input type="password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} autoComplete="off" required />
          </label>
          <label className="field">
            <span>Webhook token</span>
            <input value={webhookToken} onChange={(event) => setWebhookToken(event.target.value)} autoComplete="off" spellCheck="false" placeholder="Leave blank to generate one" />
          </label>
          <button className="btn" type="submit" disabled={saving || !account}>{saving ? "Checking…" : "Save and connect"}</button>
        </form>

        <aside className="card stack tight">
          <h2>Connection</h2>
          {!account ? <p className="muted">Loading…</p> : null}
          {account && !account.connected ? <p className="muted">Not connected yet.</p> : null}
          {account?.connected ? (
            <>
              <p className="sum"><span>Balance</span><b>{account.balance === null ? "—" : taka(account.balance)}</b></p>
              <p className="sum"><span>Last check</span><b>{account.checkedAt ? when(account.checkedAt) : "Just now"}</b></p>
              <div className="actions">
                <button type="button" className="btn secondary" disabled={saving} onClick={refresh}>Check balance</button>
                <button type="button" className="btn danger" disabled={saving} onClick={disconnect}>Disconnect</button>
              </div>
            </>
          ) : null}
          {account?.webhookUrl ? (
            <div className="stack tight">
              <p className="muted small">Paste this address and token on Steadfast's webhook page. Status updates will arrive even when this site is closed.</p>
              <p className="sum"><span>Callback URL</span></p>
              <CopyText value={account.webhookUrl} label="Webhook address" className="copy-block" />
              {account.webhookToken ? <CopyText value={account.webhookToken} label="Token" className="copy-block" /> : null}
            </div>
          ) : null}
        </aside>
      </div>

      <article className="card stack tight">
        <div className="card-head">
          <h2>Order filters</h2>
          {hidden ? <p className="muted">{shown} of {filterStatuses.length} shown on All orders</p> : null}
        </div>
        <p className="muted">Tick the Steadfast statuses you want on All orders. Untick any you want to hide, then save.</p>
        {!hidden ? <p className="muted">Loading…</p> : (
          <>
            <div className="check-grid">
              {filterStatuses.map((item) => (
                <label key={item.id} className="check">
                  <input
                    type="checkbox"
                    checked={!hidden.has(item.id)}
                    onChange={() => toggleFilter(item.id)}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
            <div className="actions filter-actions">
              <button type="button" className="text-btn" disabled={savingFilters} onClick={() => setHidden(new Set())}>Show all</button>
              <button type="button" className="btn" disabled={savingFilters} onClick={saveFilters}>{savingFilters ? "Saving…" : "Save filters"}</button>
            </div>
          </>
        )}
      </article>

      <article className="card list-card parcel-card">
        <div className="card-head">
          <h2>Parcels</h2>
        </div>
        {!parcelsReady ? <p className="muted">Loading…</p> : null}
        {parcelsReady && parcelTotal === 0 ? <p className="muted">No parcels booked yet. Mark an order as In courier and it will be booked.</p> : null}
        {parcels.length > 0 ? (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Tracking</th>
                  <th>Steadfast</th>
                  <th>Order status</th>
                </tr>
              </thead>
              <tbody>
                {parcels.map((parcel) => (
                  <tr key={parcel.id} onClick={() => go(`/orders/${parcel.id}`)}>
                    <td data-label="Order"><strong>{parcel.number}</strong></td>
                    <td data-label="Customer">{parcel.customerName}<small>{parcel.mobile}</small></td>
                    <td data-label="Tracking">{parcel.trackingCode || parcel.consignmentId}</td>
                    <td data-label="Steadfast">{courierStatusLabel(parcel.courierStatus) || "Pending"}</td>
                    <td data-label="Order status">{statusLabel(parcel.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {parcelsReady && parcelTotal > 0 ? (
          <Pager
            page={parcelPage}
            total={parcelTotal}
            pageSize={parcelPageSize}
            pageSizes={PAGE_SIZES}
            onPage={(next) => {
              setParcelPage(next)
              document.querySelector(".parcel-card")?.scrollIntoView({ block: "start", behavior: "smooth" })
            }}
            onPageSize={(next) => { setParcelPageSize(next); setParcelPage(1) }}
          />
        ) : null}
      </article>
    </section>
  )
}
