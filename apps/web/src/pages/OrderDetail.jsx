import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { MANUAL_STATUSES, PAYMENTS, courierStatusLabel, holdsStock, statusLabel } from "@rose/shared"
import { api, fromInputValue, toInputValue } from "../api.js"
import { paymentLabel, taka, when } from "../format.js"
import { addTo, lineKey, toggleGiftIn } from "../lines.js"
import { useRoute } from "../route.jsx"
import Select, { productOptions } from "../select.jsx"
import { SourceField } from "../sources.jsx"
import { ParcelEye } from "../ParcelModal.jsx"
import { Banner, ContactActions, CopyText, Field, StatusPill, askConfirm, courierStatusQuestion } from "../ui.jsx"

export default function OrderDetail({ id }) {
  const { go } = useRoute()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState("")
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [sources, setSources] = useState([])
  const [couriers, setCouriers] = useState([])
  const [products, setProducts] = useState([])
  const [lines, setLines] = useState([])
  const [pick, setPick] = useState([])
  const [draft, setDraft] = useState(null)
  const [steps, setSteps] = useState([])

  useEffect(() => {
    let live = true
    setOrder(null)
    setError("")
    setMissing(false)
    setEditing(false)
    api(`/api/orders/${id}`)
      .then((body) => {
        if (!live) return
        setOrder(body.order)
      })
      .catch((reason) => {
        if (!live) return
        setError(reason.message)
        setMissing(true)
      })
    return () => { live = false }
  }, [id])

  useEffect(() => {
    let live = true
    Promise.all([api("/api/sources"), api("/api/products"), api("/api/courier/active")])
      .then(([sourceBody, catalog, courierBody]) => {
        if (!live) return
        setSources(sourceBody.sources)
        setProducts(catalog.products)
        setCouriers(courierBody.couriers)
      })
      .catch(() => {})
    return () => { live = false }
  }, [])

  function beginEdit() {
    const catalog = products
    setDraft({
      customerName: order.customerName,
      mobile: order.mobile,
      address: order.address,
      courier: order.courier,
      status: order.status,
      orderedAt: toInputValue(order.orderedAt),
      deliveryCharge: order.deliveryCharge > 0 ? String(order.deliveryCharge) : "",
      deliveryPaidBy: order.deliveryPaidBy || "customer",
      discount: order.discount ? String(order.discount) : "",
      paidAmount: order.paidAmount ? String(order.paidAmount) : "",
      paymentMethod: order.paymentMethod,
      note: order.note || "",
      privateNote: order.privateNote || "",
      sourceId: order.sourceId ? String(order.sourceId) : "",
    })
    setLines(order.items.map((item) => {
      const product = catalog.find((entry) => entry.id === item.productId)
      return {
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        sellPrice: item.gift ? (order.items.find((other) => other.productId === item.productId && !other.gift)?.unitPrice ?? product?.sellPrice ?? 0) : item.unitPrice,
        costPrice: item.unitCost,
        isCombo: Boolean(product?.isCombo),
        components: product?.components || [],
        gift: Boolean(item.gift),
      }
    }))
    setPick([])
    setEditing(true)
  }

  function setDraftField(key, value) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function addLine(ids) {
    const chosen = ids.map((id) => products.find((item) => item.id === Number(id))).filter(Boolean)
    if (!chosen.length) return
    setError("")
    setLines((current) => chosen.reduce((next, product) => addTo(next, {
      productId: product.id,
      name: product.name,
      quantity: 1,
      sellPrice: product.sellPrice,
      costPrice: product.costPrice,
      isCombo: product.isCombo,
      components: product.components,
      gift: false,
    }), current))
    setPick([])
  }

  function setLineQty(key, value) {
    const quantity = Number(value)
    if (!Number.isInteger(quantity) || quantity <= 0) return
    setLines((current) => current.map((line) => lineKey(line) === key ? { ...line, quantity } : line))
  }

  async function changeStatus(status) {
    if (!order || status === order.status || saving) return
    const question = courierStatusQuestion(order, status)
    if (question && !await askConfirm(question)) return
    setSaving(true)
    setError("")
    try {
      const body = await api(`/api/orders/${order.id}`, {
        method: "PATCH",
        body: payload(order, { status }),
      })
      setOrder(body.order)
      api("/api/products").then((catalog) => setProducts(catalog.products)).catch(() => {})
      if (body.order.courierError && !body.order.consignmentId) {
        toast.error(body.order.courierError)
        return
      }
      const back = !holdsStock(status) && holdsStock(order.status)
      toast.success(back ? `Marked ${statusLabel(status)}. Stock is back.` : `Status is now ${statusLabel(status)}`)
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    if (!lines.length) {
      setError("Add at least one product")
      return
    }
    if (shortage) {
      const product = products.find((item) => item.id === shortage[0])
      setError(`Not enough ${product?.name || "stock"}`)
      return
    }
    const question = courierStatusQuestion({ ...order, courier: draft.courier }, draft.status)
    if (question && !await askConfirm(question)) return
    setSaving(true)
    setError("")
    try {
      const body = await api(`/api/orders/${order.id}`, {
        method: "PATCH",
        body: payload(order, {
          customerName: draft.customerName,
          mobile: draft.mobile,
          address: draft.address,
          courier: draft.courier,
          status: draft.status,
          orderedAt: fromInputValue(draft.orderedAt),
          paymentMethod: draft.paymentMethod,
          paidAmount: numberOrZero(draft.paidAmount),
          deliveryCharge: numberOrZero(draft.deliveryCharge),
          deliveryPaidBy: draft.deliveryPaidBy,
          discount: numberOrZero(draft.discount),
          note: draft.note,
          privateNote: draft.privateNote,
          sourceId: draft.sourceId || null,
          items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, gift: line.gift })),
        }),
      })
      setOrder(body.order)
      setEditing(false)
      setDraft(null)
      if (body.order.courierError && !body.order.consignmentId) toast.error(body.order.courierError)
      else toast.success("Updated")
      api("/api/products").then((catalog) => setProducts(catalog.products)).catch(() => {})
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function sendParcel() {
    setSaving(true)
    setError("")
    try {
      const body = await api(`/api/orders/${order.id}/dispatch`, { method: "POST", body: {} })
      setOrder(body.order)
      toast.success("Parcel booked")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function refreshTrack() {
    setSaving(true)
    setError("")
    try {
      const body = await api(`/api/orders/${order.id}/track`, { method: "POST", body: {} })
      setOrder(body.order)
      setSteps(body.steps || [])
      toast.success("Status updated")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function askReturn() {
    const sure = await askConfirm({
      title: "Ask Steadfast to return this parcel?",
      message: "The order becomes Cancelled. The pieces come back to stock when the parcel reaches you.",
      yes: "Yes, request return",
      danger: true,
    })
    if (!sure) return
    setSaving(true)
    setError("")
    try {
      const body = await api(`/api/orders/${order.id}/return`, { method: "POST", body: { reason: "Customer asked for a return" } })
      setOrder(body.order)
      toast.success("Return requested")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function forgetParcel() {
    setSaving(true)
    setError("")
    try {
      const body = await api(`/api/orders/${order.id}/courier/removed`, { method: "POST", body: {} })
      setOrder(body.order)
      setSteps([])
      setConfirmUnlink(false)
      toast.success("Unlinked from Steadfast. Fix the order and send it again.")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setSaving(true)
    setError("")
    try {
      await api(`/api/orders/${order.id}`, { method: "DELETE" })
      toast.success("Order deleted")
      go("/orders")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
      setSaving(false)
      setConfirmDelete(false)
    }
  }

  const needs = requiredPieces(lines, products)
  const heldPieces = order?.stockHeld ? requiredPieces(order.items, products) : new Map()
  const activeStatus = draft?.status || order?.status
  const shortage = order && holdsStock(activeStatus)
    ? [...needs].find(([productId, quantity]) => {
      const product = products.find((item) => item.id === productId)
      const have = (product?.stockQty || 0) + (heldPieces.get(productId) || 0)
      return have < quantity
    })
    : null
  const goods = lines.reduce((sum, line) => sum + (line.gift ? 0 : line.sellPrice * line.quantity), 0)
  const cost = lines.reduce((sum, line) => sum + line.costPrice * line.quantity, 0)
  const giftCost = lines.reduce((sum, line) => sum + (line.gift ? line.costPrice * line.quantity : 0), 0)
  const discount = numberOrZero(draft?.discount)
  const delivery = numberOrZero(draft?.deliveryCharge)
  const paid = numberOrZero(draft?.paidAmount)
  const customerPaysDelivery = draft?.deliveryPaidBy === "customer"
  const codOnBill = order?.codPaidBy === "customer" ? order.codCharge : 0
  const codExpense = order && order.codPaidBy !== "customer" ? order.codCharge : 0
  const total = goods - discount + (customerPaysDelivery ? delivery : 0) + codOnBill
  const due = total - paid
  const profit = goods - discount - cost - (customerPaysDelivery ? 0 : delivery) - codExpense

  if (!order) {
    return (
      <section className="page">
        <Banner message={error} />
        {missing ? <button type="button" className="btn" onClick={() => go("/orders")}>Go to all orders</button> : <p className="muted">Loading…</p>}
      </section>
    )
  }

  return (
    <section className="page order-detail">
      <div className="page-head">
        <div>
          <button type="button" className="text-btn back" onClick={() => go("/orders")}>All orders</button>
          <div className="detail-title">
            <h1>{order.number}</h1>
            <StatusPill status={editing && draft ? draft.status : order.status} />
          </div>
          <p className="muted">{order.customerName}{order.sourceName ? ` · ${order.sourceName}` : ""} · {when(order.orderedAt)}</p>
        </div>
        <div className="actions">
          <button type="button" className="btn secondary" onClick={() => {
            if (editing) {
              setEditing(false)
              setDraft(null)
              setError("")
            } else beginEdit()
          }}>{editing ? "Close" : "Edit"}</button>
          <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>
      </div>
      <Banner message={error} />

      {editing && draft ? (
        <form className="order-layout order-create" onSubmit={save}>
          <div className="stack">
            {order.consignmentId ? <Banner message="This parcel is booked with Steadfast. Name, phone, address, items, and amounts are locked. Changing the status does not send new details to the courier." tone="good" /> : null}
            <article className="card">
              <div className="create-grid">
                <Field label="Name">
                  <input value={draft.customerName} onChange={(event) => setDraftField("customerName", event.target.value)} disabled={Boolean(order.consignmentId)} required />
                </Field>
                <Field label="Mobile">
                  <input value={draft.mobile} onChange={(event) => setDraftField("mobile", event.target.value)} disabled={Boolean(order.consignmentId)} required />
                </Field>
                <Field label="Courier">
                  <Select
                    label="Courier"
                    value={draft.courier}
                    onChange={(value) => setDraftField("courier", value)}
                    disabled={Boolean(order.consignmentId)}
                    required
                    options={[
                      ...(draft.courier && !couriers.some((item) => item.name === draft.courier) ? [{ value: draft.courier, label: draft.courier }] : []),
                      ...couriers.map((courier) => ({ value: courier.name, label: courier.name })),
                    ]}
                  />
                </Field>
                <Field label="Status">
                  {MANUAL_STATUSES.some((status) => status.id === draft.status) ? (
                    <Select
                      label="Status"
                      value={draft.status}
                      onChange={(value) => setDraftField("status", value)}
                      options={MANUAL_STATUSES.map((status) => ({ value: status.id, label: status.label }))}
                    />
                  ) : (
                    <input value={statusLabel(draft.status)} disabled />
                  )}
                </Field>
                <SourceField value={draft.sourceId} onChange={(value) => setDraftField("sourceId", value)} sources={sources} onSources={setSources} />
                <Field label="Order time" className="span-2">
                  <input type="datetime-local" value={draft.orderedAt} onChange={(event) => setDraftField("orderedAt", event.target.value)} required />
                </Field>
                <Field label="Address" className="wide">
                  <textarea rows={3} value={draft.address} onChange={(event) => setDraftField("address", event.target.value)} disabled={Boolean(order.consignmentId)} required />
                </Field>
              </div>
            </article>
            <article className="card">
              <div className="add-line single">
                <Select
                  multiple
                  search
                  label="Products"
                  value={pick}
                  onChange={setPick}
                  onDone={addLine}
                  placeholder="Choose products"
                  disabled={Boolean(order.consignmentId)}
                  options={productOptions(products, (product) => product.isCombo ? `can make ${shownCombo(product, products, heldPieces)}` : `in stock ${shownStock(product, heldPieces)}`)}
                />
              </div>
              {lines.length === 0 ? <p className="muted small">Add a product.</p> : (
                <ul className="lines create-lines">
                  {lines.map((line) => {
                    const product = products.find((item) => item.id === line.productId)
                    const components = product?.isCombo ? product.components : []
                    const key = lineKey(line)
                    return (
                    <li key={key} className={line.gift ? "gift-line" : undefined}>
                      <div>
                        <strong>{line.name}{line.gift ? <span className="gift-tag">Gift</span> : null}</strong>
                        {components.length ? <small>{components.map((part) => `${part.name} ×${part.quantity}`).join(", ")}</small> : null}
                        {line.gift ? <small>Your cost {taka(line.costPrice * line.quantity)}</small> : null}
                      </div>
                      <input className="line-qty" aria-label={`${line.name} quantity`} type="number" min="1" step="1" value={line.quantity} onChange={(event) => setLineQty(key, event.target.value)} disabled={Boolean(order.consignmentId)} />
                      <b>{line.gift ? "Free" : taka(line.sellPrice * line.quantity)}</b>
                      <div className="line-actions">
                        <button type="button" className={line.gift ? "gift-btn on" : "gift-btn"} aria-pressed={line.gift} onClick={() => setLines((current) => toggleGiftIn(current, key))} disabled={Boolean(order.consignmentId)}>{line.gift ? "Gifted" : "Gift"}</button>
                        <button type="button" className="text-btn" onClick={() => setLines((current) => current.filter((item) => lineKey(item) !== key))} disabled={Boolean(order.consignmentId)}>Remove</button>
                      </div>
                    </li>
                    )
                  })}
                </ul>
              )}
              {shortage ? <p className="banner banner-bad">{products.find((item) => item.id === shortage[0])?.name} does not have enough stock.</p> : null}
            </article>
          </div>
          <aside className="card summary">
            <div className="bill-grid">
              <Field label="Discount">
                <input type="number" min="0" step="1" value={draft.discount} onChange={(event) => setDraftField("discount", event.target.value)} placeholder="0" disabled={Boolean(order.consignmentId)} />
              </Field>
              <Field label="Paid">
                <input type="number" min="0" step="1" value={draft.paidAmount} onChange={(event) => setDraftField("paidAmount", event.target.value)} placeholder="0" disabled={Boolean(order.consignmentId)} />
              </Field>
            </div>
            <Field label="Payment">
              <Select
                label="Payment"
                value={draft.paymentMethod}
                onChange={(value) => setDraftField("paymentMethod", value)}
                disabled={Boolean(order.consignmentId)}
                options={PAYMENTS.map((payment) => ({ value: payment.id, label: payment.label }))}
              />
            </Field>
            <div className="field">
              <span>Delivery</span>
              <div className="cod-row">
                <button type="button" className={draft.deliveryPaidBy === "free" ? "pill-btn active" : "pill-btn"} onClick={() => setDraftField("deliveryPaidBy", "free")} disabled={Boolean(order.consignmentId)}>Free</button>
                <button type="button" className={draft.deliveryPaidBy === "customer" ? "pill-btn active" : "pill-btn"} onClick={() => setDraftField("deliveryPaidBy", "customer")} disabled={Boolean(order.consignmentId)}>Customer</button>
                <input type="number" min="0" step="1" value={draft.deliveryCharge} onChange={(event) => setDraftField("deliveryCharge", event.target.value)} placeholder="Amount" aria-label="Delivery amount" disabled={Boolean(order.consignmentId)} />
              </div>
            </div>
            <Field label="Courier note">
              <textarea rows="2" value={draft.note} onChange={(event) => setDraftField("note", event.target.value)} placeholder="Goes to Steadfast for the rider" maxLength={400} disabled={Boolean(order.consignmentId)} />
            </Field>
            <Field label="Private note">
              <textarea rows="2" value={draft.privateNote} onChange={(event) => setDraftField("privateNote", event.target.value)} placeholder="Only you see this" maxLength={1000} />
            </Field>
            <p className="sum"><span>Items</span><b>{taka(goods)}</b></p>
            {giftCost > 0 ? <p className="sum"><span>Gift (your cost)</span><b>{taka(giftCost)}</b></p> : null}
            <p className="sum"><span>{delivery > 0 && !customerPaysDelivery ? "Delivery (you)" : "Delivery"}</span><b>{delivery > 0 ? taka(delivery) : "Free"}</b></p>
            {order.codCharge > 0 ? <p className="sum"><span>{order.codPaidBy === "customer" ? "COD charge" : "COD (you)"}</span><b>{taka(order.codCharge)}</b></p> : null}
            <p className="sum strong"><span>Total</span><b>{taka(total)}</b></p>
            <p className="sum strong"><span>Due</span><b>{taka(due)}</b></p>
            <p className="sum strong"><span>Profit</span><b>{taka(profit)}</b></p>
            <button className="btn wide" type="submit" disabled={saving || Boolean(shortage)}>{saving ? "Saving…" : "Save"}</button>
          </aside>
        </form>
      ) : (
        <>
          <div className="status-rail" role="group" aria-label="Status">
            {MANUAL_STATUSES.some((status) => status.id === order.status) ? MANUAL_STATUSES.map((status) => (
              <button
                key={status.id}
                type="button"
                className={order.status === status.id ? "on" : ""}
                aria-pressed={order.status === status.id}
                disabled={saving}
                onClick={() => changeStatus(status.id)}
              >
                {status.label}
              </button>
            )) : (
              <button type="button" className="on" disabled>{statusLabel(order.status)}</button>
            )}
          </div>
          <div className="detail">
            <div className="stack">
              <article className="card who-card">
                <div className="who-head">
                  <h2><CopyText value={order.customerName} label="Name" /></h2>
                  <div className="who-phone">
                    <CopyText value={order.mobile} label="Number" />
                    <ContactActions mobile={order.mobile} />
                  </div>
                </div>
                <p className="who-address"><CopyText value={order.address} label="Address" /></p>
                <div className="fact-grid">
                  <p><span>Courier</span><b>{order.courier}</b></p>
                  <p><span>Source</span><b>{order.sourceName || "Not set"}</b></p>
                  <p><span>Payment</span><b>{paymentLabel(order.paymentMethod)}</b></p>
                  <p><span>Time</span><b>{when(order.orderedAt)}</b></p>
                </div>
                {order.note ? <p className="who-note"><span>Courier note</span>{order.note}</p> : null}
                {order.privateNote ? <p className="who-note private"><span>Private note</span>{order.privateNote}</p> : null}
              </article>
              {order.courier.trim().toLowerCase() === "steadfast" ? (
                <article className="card">
                  <div className="card-head">
                    <h2>Steadfast</h2>
                    <span className="actions">
                      {order.consignmentId ? <ParcelEye orderId={order.id} /> : null}
                      {order.trackingUrl ? <a className="text-btn" href={order.trackingUrl} target="_blank" rel="noreferrer">Open in Steadfast</a> : null}
                    </span>
                  </div>
                  {order.courierError && !order.consignmentId ? <Banner message={order.courierError} /> : null}
                  {order.consignmentId ? (
                    <>
                      <ChargeBox order={order} onSaved={setOrder}>
                        <button type="button" className="btn secondary small-btn" disabled={saving} onClick={refreshTrack}>Refresh status</button>
                        {order.status === "courier" && ["in_review", "pending"].includes(order.courierStatus) ? (
                          <button type="button" className="btn secondary small-btn" disabled={saving} onClick={() => setConfirmUnlink(true)}>Removed in Steadfast</button>
                        ) : order.status === "courier" ? (
                          <button type="button" className="btn danger small-btn" disabled={saving} onClick={askReturn}>Request return</button>
                        ) : null}
                      </ChargeBox>
                      {steps.length > 0 ? (
                        <ol className="track-steps">
                          {steps.map((step, index) => (
                            <li key={`${step.at}-${index}`}>
                              <div>{step.text}</div>
                              {step.at ? <small>{when(step.at)}</small> : null}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </>
                  ) : (
                    <button type="button" className="btn" disabled={saving} onClick={sendParcel}>Send to Steadfast</button>
                  )}
                </article>
              ) : null}
              <ItemsCard order={order} onSaved={setOrder} />
            </div>
            <aside className="card summary bill">
              <h2>Totals</h2>
              <p className="sum"><span>Items</span><b>{taka(order.goods)}</b></p>
              <p className="sum"><span>Discount</span><b>{taka(order.discount)}</b></p>
              <p className="sum"><span>{order.deliveryPaidBy === "free" && order.deliveryCharge > 0 ? "Delivery (you)" : "Delivery"}</span><b>{order.deliveryCharge > 0 ? taka(order.deliveryCharge) : "Free"}</b></p>
              <p className="sum strong"><span>Total</span><b>{taka(order.total)}</b></p>
              {order.returnSettled ? <p className="sum note-line"><span>Closed at what Steadfast collected</span></p> : null}
              <p className="sum"><span>Paid</span><b>{taka(order.paidAmount)}</b></p>
              <p className="sum"><span>Cost</span><b>{taka(order.cost)}</b></p>
              {order.courierCost - order.codFee > 0 ? (
                <p className="sum">
                  <span>Courier charge{order.courierCharge === null ? "" : order.courierChargeBy === "manual" ? " · you entered" : " · Steadfast"}</span>
                  <b>{taka(order.courierCost - order.codFee)}</b>
                </p>
              ) : null}
              {order.codFee > 0 ? (
                <p className="sum">
                  <span>{order.courierCod === null ? "COD charge" : "COD charge · 1% Steadfast"}</span>
                  <b>{taka(order.codFee)}</b>
                </p>
              ) : null}
              {order.gifts > 0 ? <p className="sum"><span>Gift (your cost)</span><b>{taka(order.gifts)}</b></p> : null}
              <div className="bill-spots">
                <p className={order.due > 0 ? "due" : ""}><span>Due</span><b>{taka(order.due)}</b></p>
                <p className="gain"><span>Profit</span><b>{taka(order.profit)}</b></p>
              </div>
            </aside>
          </div>
        </>
      )}

      {confirmUnlink ? (
        <div className="modal-back" role="presentation" onClick={() => { if (!saving) setConfirmUnlink(false) }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unlink-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="unlink-title">Removed in Steadfast?</h2>
            <p className="muted">First press "Remove parcel" in the Steadfast panel. Then this order goes back to Confirmed, and you can fix it and send it again.</p>
            <div className="actions">
              <button type="button" className="btn secondary" disabled={saving} onClick={() => setConfirmUnlink(false)}>No</button>
              <button type="button" className="btn" disabled={saving} onClick={forgetParcel}>{saving ? "Saving…" : "Yes, I removed it"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="modal-back" role="presentation" onClick={() => { if (!saving) setConfirmDelete(false) }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="delete-title">Delete {order.number}?</h2>
            <p className="muted">The order will leave the list. Stock that was held will come back.</p>
            <div className="actions">
              <button type="button" className="btn secondary" disabled={saving} onClick={() => setConfirmDelete(false)}>No</button>
              <button type="button" className="btn danger" disabled={saving} onClick={remove}>{saving ? "Deleting…" : "Yes, delete"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ItemsCard({ order, onSaved }) {
  const [counts, setCounts] = useState(null)
  const [busy, setBusy] = useState(false)
  const partial = order.status === "delivered" && String(order.courierStatus || "").startsWith("partial_delivered")
  const editing = counts !== null

  function start() {
    setCounts(Object.fromEntries(order.items.map((item) => [item.id, item.returned || 0])))
  }

  async function save(undo = false) {
    setBusy(true)
    try {
      const items = order.items.map((item) => ({ id: item.id, returned: Number(counts?.[item.id] || 0) }))
      const body = await api(`/api/orders/${order.id}/returned`, { method: "PUT", body: undo ? { undo: true } : { items } })
      onSaved(body.order)
      setCounts(null)
      toast.success(undo ? "Return undone" : "Saved. Stock, due and profit are fixed.")
    } catch (reason) {
      toast.error(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card">
      <div className="card-head">
        <h2>Items</h2>
        {partial && !editing ? (
          <span className="actions">
            <button type="button" className="text-btn" onClick={start}>{order.returnSettled ? "Change came back" : "Pieces came back"}</button>
            {order.returnSettled ? <button type="button" className="text-btn" disabled={busy} onClick={() => save(true)}>Undo</button> : null}
          </span>
        ) : null}
      </div>
      {partial && !order.returnSettled && !editing ? (
        <p className="return-hint">Partly delivered. Mark the pieces that came back so stock, due and profit are right.</p>
      ) : null}
      <ul className="lines detail-lines">
        {order.items.map((item) => {
          const kept = item.quantity - (item.returned || 0)
          return (
            <li key={item.id} className={item.gift ? "gift-line" : undefined}>
              <div>
                <strong>{item.name}{item.gift ? <span className="gift-tag">Gift</span> : null}</strong>
                {!editing && item.returned > 0 ? <span className="back-tag">{item.returned} came back</span> : null}
              </div>
              {editing ? (
                <label className="back-input">
                  <span>Came back</span>
                  <input
                    type="number"
                    min="0"
                    max={item.quantity}
                    step="1"
                    inputMode="numeric"
                    value={counts[item.id]}
                    onChange={(event) => setCounts({ ...counts, [item.id]: event.target.value })}
                  />
                  <small className="muted">of {item.quantity}</small>
                </label>
              ) : (
                <span>{item.gift ? `${kept} × free` : `${kept} × ${taka(item.unitPrice)}`}</span>
              )}
              <b>{item.gift ? "Free" : taka(item.unitPrice * (editing ? item.quantity : kept))}</b>
            </li>
          )
        })}
      </ul>
      {editing ? (
        <div className="return-actions">
          <button type="button" className="btn small-btn" disabled={busy} onClick={() => save(false)}>{busy ? "Saving…" : "Save"}</button>
          <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => setCounts(null)}>Cancel</button>
          <small className="muted">The pieces go back to stock. The order closes at what Steadfast collected.</small>
        </div>
      ) : null}
    </article>
  )
}

function ChargeBox({ order, onSaved, children }) {
  const [value, setValue] = useState("")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save(charge) {
    setBusy(true)
    try {
      const body = await api(`/api/orders/${order.id}/courier-charge`, { method: "PUT", body: { charge } })
      onSaved(body.order)
      setOpen(false)
      toast.success(charge === null ? "Back to the estimate" : "Charge saved")
    } catch (reason) {
      toast.error(reason.message)
    } finally {
      setBusy(false)
    }
  }

  const known = order.courierCharge !== null
  return (
    <div className="charge-box">
      <div className="fact-grid parcel-facts">
        <p><span>Status</span><b>{courierStatusLabel(order.courierStatus) || "Pending"}</b></p>
        <p>
          <span>Tracking</span>
          <b>{order.trackingCode ? <CopyText value={order.trackingCode} label="Tracking code" /> : order.consignmentId}</b>
        </p>
        <p>
          <span>Charge</span>
          <b>{known ? taka(order.courierCharge) : taka(order.deliveryCharge)}</b>
          <small className="muted">{known ? (order.courierChargeBy === "manual" ? "You entered" : "From Steadfast") : "Estimate"}</small>
        </p>
        <p>
          <span>Collected</span>
          <b>{order.courierCod === null ? "—" : taka(order.courierCod)}</b>
          <small className="muted">{order.courierCod === null ? "Not yet" : order.codFee > 0 ? `1% COD ${taka(order.codFee)}` : "By Steadfast"}</small>
        </p>
      </div>
      {open ? (
        <form className="charge-form" onSubmit={(event) => { event.preventDefault(); save(value) }}>
          <input type="number" min="0" step="1" inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} placeholder="What Steadfast charged" required autoFocus />
          <button type="submit" className="btn small-btn" disabled={busy}>Save</button>
          <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        </form>
      ) : (
        <div className="parcel-actions">
          {children}
          <span className="parcel-charge-links">
            <button type="button" className="text-btn" onClick={() => { setValue(known ? String(order.courierCharge) : ""); setOpen(true) }}>
              {known ? "Change charge" : "Enter charge"}
            </button>
            {order.courierChargeBy === "manual" ? <button type="button" className="text-btn" disabled={busy} onClick={() => save(null)}>Clear</button> : null}
          </span>
        </div>
      )}
    </div>
  )
}

function payload(order, overrides) {
  return {
    customerName: order.customerName,
    mobile: order.mobile,
    address: order.address,
    courier: order.courier,
    orderedAt: order.orderedAt,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paidAmount: order.paidAmount,
    deliveryCharge: order.deliveryCharge,
    deliveryPaidBy: order.deliveryPaidBy || "customer",
    discount: order.discount,
    codPaidBy: order.codPaidBy || "free",
    codCharge: order.codCharge || 0,
    note: order.note,
    sourceId: order.sourceId,
    ...overrides,
  }
}

function numberOrZero(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function requiredPieces(lines, products) {
  const needs = new Map()
  for (const line of lines) {
    const product = products.find((item) => item.id === line.productId)
    if (!product) continue
    if (product.isCombo) {
      for (const part of product.components) {
        needs.set(part.productId, (needs.get(part.productId) || 0) + part.quantity * line.quantity)
      }
    } else {
      needs.set(product.id, (needs.get(product.id) || 0) + line.quantity)
    }
  }
  return needs
}

function shownStock(product, held) {
  return product.stockQty + (held.get(product.id) || 0)
}

function shownCombo(product, products, held) {
  if (!product.components.length) return 0
  return product.components.reduce((min, part) => {
    const piece = products.find((item) => item.id === part.productId)
    const have = (piece?.stockQty || 0) + (held.get(part.productId) || 0)
    return Math.min(min, Math.floor(have / part.quantity))
  }, Infinity)
}
