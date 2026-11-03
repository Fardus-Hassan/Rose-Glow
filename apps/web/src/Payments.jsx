import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import toast from "react-hot-toast"
import { api } from "./api.js"
import { taka, when } from "./format.js"
import { useRoute } from "./route.jsx"
import { CopyChip, Pager } from "./ui.jsx"

const PAGE_SIZES = [10, 20, 50, 100]

function keyLabel(key) {
  const words = String(key).replace(/_/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function money(value) {
  return value === null || value === undefined ? "—" : taka(value)
}

export default function PaymentsCard({ connected }) {
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [syncing, setSyncing] = useState(false)
  const [openRef, setOpenRef] = useState("")
  const [error, setError] = useState("")
  const autoTried = useRef(false)

  const load = useCallback(async () => {
    const query = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) })
    const body = await api(`/api/courier/payments?${query}`)
    setData(body)
    return body
  }, [page, pageSize])

  const sync = useCallback(async (quiet = false) => {
    setSyncing(true)
    setError("")
    try {
      let added = 0
      for (let round = 0; round < 15; round += 1) {
        const result = await api("/api/courier/payments/sync", { method: "POST", body: {} })
        if (result.busy) {
          if (!quiet) toast("A sync is already running. Try again in a moment.")
          break
        }
        added += result.added || 0
        await load()
        if (!result.more) break
      }
      if (!quiet) toast.success(added ? `${added} new ${added === 1 ? "payment" : "payments"} saved` : "Payments are up to date")
    } catch (reason) {
      setError(reason.message)
      if (!quiet) toast.error(reason.message)
    } finally {
      setSyncing(false)
    }
  }, [load])

  useEffect(() => {
    let live = true
    load()
      .then((body) => {
        if (!live || autoTried.current || !connected) return
        autoTried.current = true
        if (!body.sync?.at || !body.sync?.complete) sync(true)
      })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [load, sync, connected])

  const totals = data?.totals
  return (
    <article className="card list-card payment-card">
      <div className="card-head">
        <div>
          <h2>Payments</h2>
          <p className="muted small">
            Money Steadfast sent you, with the parcels in each payment. Saved here, so nothing is lost.
            {data?.sync?.at ? ` Last checked ${when(data.sync.at)}.` : ""}
          </p>
        </div>
        <button type="button" className="btn secondary" disabled={!connected || syncing} onClick={() => sync(false)}>
          {syncing ? "Checking…" : "Check payments"}
        </button>
      </div>
      {error ? <p className="banner banner-bad">{error}</p> : null}
      {data?.sync?.error && !error ? <p className="banner banner-bad">Last check failed: {data.sync.error}</p> : null}
      {totals && totals.payouts > 0 ? (
        <div className="payment-totals">
          <p><span>Paid to you</span><b>{taka(totals.amount)}</b></p>
          <p><span>Payments</span><b>{totals.payouts}</b></p>
          <p><span>Parcels paid</span><b>{totals.parcels}</b></p>
          <p><span>Last payment</span><b>{totals.lastPaid ? when(totals.lastPaid) : "—"}</b></p>
        </div>
      ) : null}
      {!data ? <p className="muted">Loading…</p> : null}
      {data && data.total === 0 ? (
        <p className="muted">{!connected ? "Connect Steadfast to see payments." : syncing ? "Getting payments from Steadfast…" : "No payments from Steadfast yet."}</p>
      ) : null}
      {data && data.payments.length > 0 ? (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Payment</th>
                <th>Received</th>
                <th>Status</th>
                <th>Method</th>
                <th>Parcels</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((payment) => (
                <tr key={payment.ref} onClick={() => setOpenRef(payment.ref)}>
                  <td data-label="Date">{payment.paidAt ? when(payment.paidAt) : "—"}</td>
                  <td data-label="Payment"><strong>{payment.label}</strong></td>
                  <td data-label="Received">
                    {money(payment.received ?? payment.amount)}
                    {payment.received !== null && payment.amount !== null && payment.amount !== payment.received ? <small>of {taka(payment.amount)}</small> : null}
                  </td>
                  <td data-label="Status">{payment.status || "—"}</td>
                  <td data-label="Method">{payment.method || "—"}</td>
                  <td data-label="Parcels">
                    {payment.loaded ? payment.parcels : "…"}
                    {payment.loaded && payment.parcels > payment.matched ? <small>{payment.parcels - payment.matched} booked outside Rose Glow</small> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data && data.total > 0 ? (
        <Pager
          page={page}
          total={data.total}
          pageSize={pageSize}
          pageSizes={PAGE_SIZES}
          onPage={(next) => {
            setPage(next)
            document.querySelector(".payment-card")?.scrollIntoView({ block: "start", behavior: "smooth" })
          }}
          onPageSize={(next) => { setPageSize(next); setPage(1) }}
        />
      ) : null}
      {openRef ? <PaymentModal paymentRef={openRef} onClose={() => setOpenRef("")} /> : null}
    </article>
  )
}

function PaymentModal({ paymentRef, onClose }) {
  const { go } = useRoute()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let live = true
    api(`/api/courier/payments/${encodeURIComponent(paymentRef)}`)
      .then((body) => { if (live) setData(body) })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [paymentRef])

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const payment = data?.payment
  return createPortal(
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal parcel-modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title" onClick={(event) => event.stopPropagation()}>
        <div className="card-head">
          <div>
            <h2 id="payment-title">{payment ? payment.label : "Payment"}</h2>
            {payment ? <p className="muted small">{payment.paidAt ? when(payment.paidAt) : ""}{(payment.received ?? payment.amount) !== null ? ` · received ${taka(payment.received ?? payment.amount)}` : ""}</p> : null}
          </div>
          <button type="button" className="text-btn" onClick={onClose}>Close</button>
        </div>
        {error ? <p className="banner banner-bad">{error}</p> : null}
        {!data && !error ? <p className="muted">Loading…</p> : null}
        {data ? (
          <>
            {data.facts.length ? (
              <div className="fact-grid payment-facts">
                {data.facts.map((fact) => (
                  <p key={fact.key}><span>{keyLabel(fact.key)}</span><b>{fact.value || "—"}</b></p>
                ))}
              </div>
            ) : null}
            <h3 className="payment-sub">Parcels in this payment ({data.parcels.length})</h3>
            {!payment.loaded ? <p className="muted small">The parcel list has not come from Steadfast yet. Tap Check payments.</p> : null}
            {payment.loaded && data.parcels.length === 0 ? <p className="muted small">Steadfast sent no parcel list for this payment.</p> : null}
            {data.parcels.length > 0 ? (
              <ul className="payment-parcels">
                {data.parcels.map((parcel) => (
                  <li key={parcel.position}>
                    <div>
                      {parcel.orderId ? (
                        <button type="button" className="text-btn" onClick={() => { onClose(); go(`/orders/${parcel.orderId}`) }}>{parcel.orderNumber}</button>
                      ) : (
                        <strong>{parcel.invoice || parcel.customerName || "Parcel"}</strong>
                      )}
                      {parcel.orderId && parcel.customerName ? <small>{parcel.customerName}</small> : null}
                      {!parcel.orderId ? <small>Booked outside Rose Glow{parcel.invoice && parcel.customerName ? ` · ${parcel.customerName}` : ""}</small> : null}
                    </div>
                    <div className="payment-parcel-ids">
                      {parcel.consignmentId ? <CopyChip value={String(parcel.consignmentId)} label="Consignment ID" tag="ID" className="consign" /> : null}
                      {parcel.trackingCode ? <small>{parcel.trackingCode}</small> : null}
                    </div>
                    <b>{money(parcel.amount)}</b>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
