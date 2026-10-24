import { useEffect, useState } from "react"
import { courierStatusLabel } from "@rose/shared"
import { api } from "./api.js"
import { taka, when } from "./format.js"

const STAGES = [
  { id: "created", label: "বুক", test: /creat|book|placed|api/i },
  { id: "picked", label: "পিকআপ", test: /pick/i },
  { id: "transit", label: "পথে", test: /transit|hub|receiv/i },
  { id: "assigned", label: "রাইডার", test: /assign|rider|delivery man/i },
  { id: "delivered", label: "ডেলিভার্ড", test: /deliver/i },
]

export function ParcelEye({ orderId }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="eye-btn" aria-label="পার্সেলের বিস্তারিত" onClick={(event) => { event.stopPropagation(); setOpen(true) }}>
        <EyeIcon />
      </button>
      {open ? <ParcelModal orderId={orderId} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function ParcelModal({ orderId, onClose }) {
  const [order, setOrder] = useState(null)
  const [steps, setSteps] = useState([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  function load() {
    setLoading(true)
    setError("")
    api(`/api/orders/${orderId}/track`, { method: "POST", body: {} })
      .then((body) => {
        setOrder(body.order)
        setSteps(newestFirst(body.steps || []))
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    function onKey(event) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [orderId])

  const stages = STAGES.map((stage) => {
    const hit = [...steps].reverse().find((step) => stage.test.test(step.text || ""))
    const done = Boolean(hit) || (stage.id === "delivered" && ["delivered", "partial_delivered"].includes(order?.courierStatus))
    return { ...stage, done, at: hit?.at || "" }
  })
  const panelUrl = order?.trackingUrl || (order?.trackingCode ? `https://steadfast.com.bd/t/${order.trackingCode}` : "")

  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal parcel-modal" role="dialog" aria-modal="true" aria-labelledby="parcel-title" onClick={(event) => event.stopPropagation()}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Steadfast</p>
            <h2 id="parcel-title">{order?.trackingCode || "পার্সেল"}</h2>
            {order ? <p className="muted small">{order.number}</p> : null}
          </div>
          <button type="button" className="eye-btn" aria-label="বন্ধ" onClick={onClose}>×</button>
        </div>

        {loading ? <p className="muted">Steadfast থেকে আনা হচ্ছে…</p> : null}
        {error ? <p className="banner banner-bad">{error}</p> : null}

        {order ? (
          <>
            <div className="parcel-status">
              <span>এখন</span>
              <strong>{courierStatusLabel(order.courierStatus) || "অপেক্ষায়"}</strong>
            </div>
            <ol className="parcel-stages">
              {stages.map((stage) => (
                <li key={stage.id} className={stage.done ? "done" : ""}>
                  <b>{stage.label}</b>
                  <small>{stage.at ? safeWhen(stage.at) : "—"}</small>
                </li>
              ))}
            </ol>
            <div className="parcel-grid">
              <section>
                <h3>গ্রাহক</h3>
                <p><b>{order.customerName}</b></p>
                <p>{order.mobile}</p>
                <p>{order.address}</p>
              </section>
              <section>
                <h3>ক্যাশ অন ডেলিভারি</h3>
                <p>বাকি <b>{taka(order.due)}</b></p>
                <p>মোট বিল <b>{taka(order.total)}</b></p>
              </section>
              <section>
                <h3>পণ্য</h3>
                <ul className="plain-list">
                  {order.items.map((item) => (
                    <li key={item.id}>{item.name} × {item.quantity}</li>
                  ))}
                </ul>
              </section>
            </div>
            <section>
              <h3>ট্র্যাকিং ইতিহাস</h3>
              {steps.length === 0 ? <p className="muted">এখনো কোনো আপডেট আসেনি।</p> : null}
              <ol className="track-steps">
                {steps.map((step, index) => (
                  <li key={`${step.at}-${index}`}>
                    <div>{step.text}</div>
                    {step.at ? <small>{safeWhen(step.at)}</small> : null}
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : null}

        <div className="actions">
          <button type="button" className="btn secondary" disabled={loading} onClick={load}>রিফ্রেশ</button>
          {panelUrl ? <a className="btn secondary" href={panelUrl} target="_blank" rel="noreferrer">Steadfast-এ খুলুন</a> : null}
          <button type="button" className="btn" onClick={onClose}>বন্ধ</button>
        </div>
      </div>
    </div>
  )
}

function newestFirst(steps) {
  return [...steps].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
}

function safeWhen(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return when(value)
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12S6.2 6.5 12 6.5 21.5 12 21.5 12 17.8 17.5 12 17.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}
