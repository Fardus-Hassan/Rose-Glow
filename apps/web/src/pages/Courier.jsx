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
      toast.success("Steadfast কানেক্ট হয়েছে")
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
      toast.success("ব্যালেন্স আপডেট হয়েছে")
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
      toast.success("Steadfast আলাদা করা হয়েছে")
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
          <p className="eyebrow">কুরিয়ার</p>
          <h1>Steadfast</h1>
        </div>
      </div>
      <p className="lede">কী বসালে অর্ডার কুরিয়ারে গেলে পার্সেল বুক হবে, আর স্ট্যাটাস বদলালে উপরের ঘণ্টায় খবর আসবে। Steadfast-এ টেস্ট মোড নেই, তাই এটা আসল পার্সেল।</p>
      <Banner message={error} />

      <div className="split">
        <form className="card stack tight" onSubmit={save}>
          <h2>{account?.connected ? "কী বদলান" : "ক্রেডেনশিয়াল"}</h2>
          {account?.connected ? <p className="muted">সেভ করা কী শেষে {account.keyHint}। নতুন কী দিলে পুরনোটা বদলে যাবে।</p> : null}
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
            <input value={webhookToken} onChange={(event) => setWebhookToken(event.target.value)} autoComplete="off" spellCheck="false" placeholder="খালি রাখলে নিজে বানিয়ে দেবে" />
          </label>
          <button className="btn" type="submit" disabled={saving || !account}>{saving ? "যাচাই হচ্ছে…" : "সেভ করে কানেক্ট করুন"}</button>
        </form>

        <aside className="card stack tight">
          <h2>কানেকশন</h2>
          {!account ? <p className="muted">লোড হচ্ছে…</p> : null}
          {account && !account.connected ? <p className="muted">এখনো কানেক্ট করা হয়নি।</p> : null}
          {account?.connected ? (
            <>
              <p className="sum"><span>ব্যালেন্স</span><b>{account.balance === null ? "—" : taka(account.balance)}</b></p>
              <p className="sum"><span>শেষ চেক</span><b>{account.checkedAt ? when(account.checkedAt) : "এখনই"}</b></p>
              <div className="actions">
                <button type="button" className="btn secondary" disabled={saving} onClick={refresh}>ব্যালেন্স দেখুন</button>
                <button type="button" className="btn danger" disabled={saving} onClick={disconnect}>আলাদা করুন</button>
              </div>
            </>
          ) : null}
          {account?.webhookUrl ? (
            <div className="stack tight">
              <p className="muted small">Steadfast প্যানেলের Webhook পেজে এই ঠিকানা আর টোকেন বসান। সাইট বন্ধ থাকলেও স্ট্যাটাস তখনই আসবে।</p>
              <p className="sum"><span>Callback URL</span></p>
              <CopyText value={account.webhookUrl} label="ওয়েবহুক ঠিকানা" className="copy-block" />
              {account.webhookToken ? <CopyText value={account.webhookToken} label="টোকেন" className="copy-block" /> : null}
            </div>
          ) : null}
        </aside>
      </div>

      <article className="card">
        <div className="card-head">
          <h2>পার্সেল</h2>
        </div>
        {parcels.length === 0 ? <p className="muted">এখনো কোনো পার্সেল বুক হয়নি। অর্ডারের স্ট্যাটাস কুরিয়ারে করলে বুক হবে।</p> : null}
        {parcels.length > 0 ? (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>অর্ডার</th>
                  <th>কাস্টমার</th>
                  <th>ট্র্যাকিং</th>
                  <th>Steadfast</th>
                  <th>হিসাব</th>
                </tr>
              </thead>
              <tbody>
                {parcels.map((parcel) => (
                  <tr key={parcel.id} onClick={() => go(`/orders/${parcel.id}`)}>
                    <td data-label="অর্ডার"><strong>{parcel.number}</strong></td>
                    <td data-label="কাস্টমার">{parcel.customerName}<small>{parcel.mobile}</small></td>
                    <td data-label="ট্র্যাকিং">{parcel.trackingCode || parcel.consignmentId}</td>
                    <td data-label="Steadfast">{courierStatusLabel(parcel.courierStatus) || "অপেক্ষায়"}</td>
                    <td data-label="হিসাব">{statusLabel(parcel.status)}</td>
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
