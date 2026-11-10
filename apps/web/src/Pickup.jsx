import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { api } from "./api.js"
import { when } from "./format.js"
import Select from "./select.jsx"
import { askConfirm } from "./ui.jsx"

const EMPTY = { stationId: "", address: "", phone: "" }

export default function PickupCard() {
  const [view, setView] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [stations, setStations] = useState(null)
  const [qty, setQty] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    api("/api/courier/pickup")
      .then((body) => {
        if (!live) return
        setView(body)
        if (!body.place) setEditing(true)
        setQty(body.inReview ? String(body.inReview) : "")
      })
      .catch((reason) => { if (live) toast.error(reason.message) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!editing || stations || !view?.connected) return
    let live = true
    api("/api/courier/pickup/stations")
      .then((body) => { if (live) setStations(body.stations) })
      .catch((reason) => { if (live) toast.error(reason.message) })
    return () => { live = false }
  }, [editing, stations, view?.connected])

  function startEdit() {
    const place = view?.place
    setForm(place ? {
      stationId: String(place.policeStationId),
      address: place.address,
      phone: place.phone,
    } : EMPTY)
    setEditing(true)
  }

  async function savePlace(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const next = await api("/api/courier/pickup/place", {
        method: "PUT",
        body: {
          policeStationId: form.stationId,
          address: form.address,
          phone: form.phone,
        },
      })
      setView(next)
      setEditing(false)
      toast.success("Pickup place saved")
    } catch (reason) {
      toast.error(reason.message)
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    const sure = await askConfirm({
      title: "Request a pickup?",
      message: `Steadfast will be asked to send a rider to ${view.place.address} for ${qty} parcel${qty === "1" ? "" : "s"}.`,
      yes: "Request pickup",
    })
    if (!sure) return
    setBusy(true)
    try {
      const next = await api("/api/courier/pickup", { method: "POST", body: { estimQty: qty, note } })
      setView(next)
      setNote("")
      toast.success(next.duplicate ? "This pickup is already open" : "Pickup requested")
    } catch (reason) {
      toast.error(reason.message)
    } finally {
      setBusy(false)
    }
  }

  const place = view?.place
  const requests = view?.requests || []
  const openId = requests.find((item) => item.open)?.id

  return (
    <article className="card pickup-card">
      <div className="card-head">
        <div>
          <h2>Pickup</h2>
          <p className="muted small">Ask Steadfast to send a rider to your shop. Each parcel is still booked from its order.</p>
        </div>
      </div>

      {!view ? <p className="muted">Loading…</p> : null}
      {view && !view.connected ? <p className="muted">Connect Steadfast above, then a rider can be requested from here.</p> : null}

      {view?.connected && editing ? (
        <form className="pickup-form" onSubmit={savePlace}>
          <label className="field">
            <span>Area</span>
            <Select
              label="Area"
              search
              required
              placeholder={stations ? "Choose an area" : "Loading areas…"}
              disabled={!stations}
              value={form.stationId}
              onChange={(stationId) => setForm({ ...form, stationId })}
              options={(stations || []).map((item) => ({
                value: String(item.id),
                label: item.name,
                hint: item.district || "",
              }))}
            />
          </label>
          <label className="field wide">
            <span>Address</span>
            <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={255} required />
          </label>
          <label className="field">
            <span>Phone</span>
            <input inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="01XXXXXXXXX" required />
          </label>
          <div className="pickup-actions">
            {place ? <button type="button" className="btn secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button> : null}
            <button className="btn" type="submit" disabled={busy || !stations}>{busy ? "Saving…" : "Save place"}</button>
          </div>
        </form>
      ) : null}

      {view?.connected && place && !editing ? (
        <>
          <div className="pickup-place">
            <div>
              <p>{place.address}</p>
              <small>{[place.thana, place.district].filter(Boolean).join(", ")} · {place.phone}</small>
            </div>
            <button type="button" className="btn secondary" onClick={startEdit}>Change</button>
          </div>
          <div className="pickup-send">
            <label className="field">
              <span>Parcels</span>
              <input inputMode="numeric" value={qty} onChange={(event) => setQty(event.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="How many" />
            </label>
            <label className="field">
              <span>Note for the rider</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Optional" />
            </label>
            <button type="button" className="btn" disabled={busy || !qty || !place.addressId} onClick={send}>{busy ? "Sending…" : "Request pickup"}</button>
          </div>
          <p className="muted small">
            {place.addressId ? "Sending again while one request is open does not call a second rider." : "The place can be saved. Steadfast does not show the address number, so Request pickup stays off."}
            {view.inReview && place.addressId ? ` ${view.inReview} in review.` : ""}
          </p>
        </>
      ) : null}

      {requests.length ? (
        <div className="pickup-history">
          <h3>Requests</h3>
          <ul className="pickup-list">
            {requests.map((item) => (
              <li key={item.id}>
                <span className={item.id === openId ? "pill pill-open" : "pill pill-earlier"}>{item.id === openId ? "Open" : "Earlier"}</span>
                <div>
                  <strong>{item.estimQty ? `${item.estimQty} parcels` : "Pickup"}</strong>
                  <p>{item.address}{item.note ? ` · ${item.note}` : ""}</p>
                </div>
                <time dateTime={item.createdAt}>{when(item.createdAt)}</time>
              </li>
            ))}
          </ul>
          <p className="muted small">Steadfast does not send pickup status back, so Open means the last request they still had when we asked again.</p>
        </div>
      ) : null}
    </article>
  )
}
