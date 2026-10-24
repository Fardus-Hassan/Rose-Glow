import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { courierStatusLabel, statusLabel } from "@rose/shared"
import { api } from "../api.js"
import { taka, when } from "../format.js"
import { useRoute } from "../route.jsx"
import { Banner, CopyText } from "../ui.jsx"

export default function Courier() {
  const { go } = useRoute()
  const [account, setAccount] = useState(null)
  const [parcels, setParcels] = useState([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [secretKey, setSecretKey] = useState("")
  const [webhookToken, setWebhookToken] = useState("")

  function applyAccount(next) {
    setAccount(next)
    setWebhookToken(next.webhookToken || "")
  }

  useEffect(() => {
    let live = true
    Promise.all([api("/api/courier/account"), api("/api/courier/parcels")])
      .then(([next, body]) => {
        if (!live) return
        applyAccount(next)
        setParcels(body.parcels)
      })
      .catch((reason) => {
        if (live) setError(reason.message)
      })
    return () => { live = false }
  }, [])

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
      const body = await api("/api/courier/parcels")
      setParcels(body.parcels)
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

  return (
    <section className="page courier-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Courier</p>
          <h1>Steadfast</h1>
        </div>
      </div>
      <p className="lede">Add the keys and a parcel is booked when an order is marked with the courier. Status changes show up in the bell. Steadfast has no test mode, so this is a real parcel.</p>
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

      <article className="card">
        <div className="card-head">
          <h2>Parcels</h2>
        </div>
        {parcels.length === 0 ? <p className="muted">No parcels booked yet. Mark an order as with the courier and it will be booked.</p> : null}
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
      </article>
    </section>
  )
}
