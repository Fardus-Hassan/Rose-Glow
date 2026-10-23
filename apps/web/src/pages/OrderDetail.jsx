import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { COURIERS, PAYMENTS, STATUSES, holdsStock, statusLabel } from "@rose/shared"
import { api, fromInputValue, toInputValue } from "../api.js"
import { paymentLabel, taka, when } from "../format.js"
import { useRoute } from "../route.jsx"
import { Banner, Field, StatusPill } from "../ui.jsx"

export default function OrderDetail({ id }) {
  const { go } = useRoute()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState("")
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState("cod")
  const [deliveryPaidBy, setDeliveryPaidBy] = useState("customer")

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
        setPaymentMethod(body.order.paymentMethod)
        setDeliveryPaidBy(body.order.deliveryPaidBy || "customer")
      })
      .catch((reason) => {
        if (!live) return
        setError(reason.message)
        setMissing(true)
      })
    return () => { live = false }
  }, [id])

  async function changeStatus(status) {
    if (!order || status === order.status || saving) return
    setSaving(true)
    setError("")
    try {
      const body = await api(`/api/orders/${order.id}`, {
        method: "PATCH",
        body: payload(order, { status }),
      })
      setOrder(body.order)
      const back = !holdsStock(status) && holdsStock(order.status)
      toast.success(back ? `${statusLabel(status)} হয়েছে। স্টক ফিরে এসেছে।` : `স্ট্যাটাস এখন ${statusLabel(status)}`)
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError("")
    try {
      const body = await api(`/api/orders/${order.id}`, {
        method: "PATCH",
        body: payload(order, {
          customerName: form.get("customerName"),
          mobile: form.get("mobile"),
          address: form.get("address"),
          courier: form.get("courier"),
          orderedAt: fromInputValue(form.get("orderedAt")),
          paymentMethod,
          paidAmount: form.get("paidAmount") || 0,
          deliveryCharge: form.get("deliveryCharge") || 0,
          deliveryPaidBy,
          discount: form.get("discount") || 0,
          note: form.get("note"),
        }),
      })
      setOrder(body.order)
      setPaymentMethod(body.order.paymentMethod)
      setDeliveryPaidBy(body.order.deliveryPaidBy || "customer")
      setEditing(false)
      toast.success("আপডেট হয়েছে")
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
      toast.success("অর্ডার মুছে ফেলা হয়েছে")
      go("/orders")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
      setSaving(false)
      setConfirmDelete(false)
    }
  }

  if (!order) {
    return (
      <section className="page">
        <Banner message={error} />
        {missing ? <button type="button" className="btn" onClick={() => go("/orders")}>সব অর্ডারে যান</button> : <p className="muted">লোড হচ্ছে…</p>}
      </section>
    )
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <button type="button" className="text-btn back" onClick={() => go("/orders")}>সব অর্ডার</button>
          <h1>{order.number}</h1>
          <p className="muted">{order.customerName} · {when(order.orderedAt)}</p>
        </div>
        <div className="actions">
          <button type="button" className="btn secondary" onClick={() => setEditing((value) => !value)}>{editing ? "বন্ধ" : "এডিট"}</button>
          <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>মুছুন</button>
        </div>
      </div>
      <Banner message={error} />

      <article className="card status-card">
        <Field label="স্ট্যাটাস">
          <select value={order.status} disabled={saving} onChange={(event) => changeStatus(event.target.value)}>
            {STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
          </select>
        </Field>
        <StatusPill status={order.status} />
      </article>

      <div className="detail">
        <div className="stack">
          {editing ? (
            <form className="card stack tight" onSubmit={save}>
              <h2>এডিট</h2>
              <Field label="নাম"><input name="customerName" defaultValue={order.customerName} required /></Field>
              <Field label="মোবাইল"><input name="mobile" defaultValue={order.mobile} required /></Field>
              <Field label="ঠিকানা"><textarea name="address" rows={2} defaultValue={order.address} required /></Field>
              <Field label="কুরিয়ার">
                <input name="courier" list="edit-couriers" defaultValue={order.courier} required />
                <datalist id="edit-couriers">{COURIERS.map((courier) => <option key={courier} value={courier} />)}</datalist>
              </Field>
              <Field label="অর্ডারের সময়"><input type="datetime-local" name="orderedAt" defaultValue={toInputValue(order.orderedAt)} required /></Field>
              <Field label="পেমেন্ট">
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                  {PAYMENTS.map((payment) => <option key={payment.id} value={payment.id}>{payment.label}</option>)}
                </select>
              </Field>
              <div className="field">
                <span>ডেলিভারি</span>
                <div className="cod-row">
                  <button type="button" className={deliveryPaidBy === "free" ? "pill-btn active" : "pill-btn"} onClick={() => setDeliveryPaidBy("free")}>ফ্রি</button>
                  <button type="button" className={deliveryPaidBy === "customer" ? "pill-btn active" : "pill-btn"} onClick={() => setDeliveryPaidBy("customer")}>কাস্টমার</button>
                  <input type="number" min="0" step="1" name="deliveryCharge" defaultValue={order.deliveryCharge > 0 ? order.deliveryCharge : ""} placeholder="টাকা" aria-label="ডেলিভারি টাকা" />
                </div>
              </div>
              <Field label="জমা"><input type="number" min="0" step="1" name="paidAmount" defaultValue={order.paidAmount} /></Field>
              <Field label="ডিসকাউন্ট"><input type="number" min="0" step="1" name="discount" defaultValue={order.discount} /></Field>
              <Field label="নোট"><input name="note" defaultValue={order.note} /></Field>
              <p className="muted small">পণ্যের লাইন বদলানো যায় না। ভুল পণ্য হলে বাতিল করে আবার দিন।</p>
              <button className="btn" type="submit" disabled={saving}>{saving ? "সেভ হচ্ছে…" : "সেভ"}</button>
            </form>
          ) : (
            <article className="card">
              <h2>কাস্টমার</h2>
              <p className="sum"><span>নাম</span><b>{order.customerName}</b></p>
              <p className="sum"><span>মোবাইল</span><b>{order.mobile}</b></p>
              <p className="sum"><span>ঠিকানা</span><b>{order.address}</b></p>
              <p className="sum"><span>কুরিয়ার</span><b>{order.courier}</b></p>
              <p className="sum"><span>পেমেন্ট</span><b>{paymentLabel(order.paymentMethod)}</b></p>
              {order.note ? <p className="sum"><span>নোট</span><b>{order.note}</b></p> : null}
              <h2 className="section-gap">পণ্য</h2>
              <ul className="lines">
                {order.items.map((item) => (
                  <li key={item.id}>
                    <div><strong>{item.name}</strong></div>
                    <span>{item.quantity} × {taka(item.unitPrice)}</span>
                    <b>{taka(item.unitPrice * item.quantity)}</b>
                  </li>
                ))}
              </ul>
            </article>
          )}
        </div>

        <aside className="card summary">
          <h2>হিসাব</h2>
          <p className="sum"><span>পণ্যের দাম</span><b>{taka(order.goods)}</b></p>
          <p className="sum"><span>ডিসকাউন্ট</span><b>{taka(order.discount)}</b></p>
          <p className="sum"><span>{order.deliveryPaidBy === "free" && order.deliveryCharge > 0 ? "ডেলিভারি (আপনি)" : "ডেলিভারি"}</span><b>{order.deliveryCharge > 0 ? taka(order.deliveryCharge) : "ফ্রি"}</b></p>
          <p className="sum strong"><span>মোট</span><b>{taka(order.total)}</b></p>
          <p className="sum"><span>জমা</span><b>{taka(order.paidAmount)}</b></p>
          <p className="sum strong"><span>বাকি</span><b className={order.due > 0 ? "danger" : ""}>{taka(order.due)}</b></p>
          <p className="sum"><span>মালের দাম</span><b>{taka(order.cost)}</b></p>
          <p className="sum strong"><span>লাভ</span><b>{taka(order.profit)}</b></p>
        </aside>
      </div>

      {confirmDelete ? (
        <div className="modal-back" role="presentation" onClick={() => { if (!saving) setConfirmDelete(false) }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="delete-title">{order.number} মুছে ফেলবেন?</h2>
            <p className="muted">অর্ডারটা আর তালিকায় থাকবে না। স্টক কেটে থাকলে ফিরে আসবে।</p>
            <div className="actions">
              <button type="button" className="btn secondary" disabled={saving} onClick={() => setConfirmDelete(false)}>না</button>
              <button type="button" className="btn danger" disabled={saving} onClick={remove}>{saving ? "মুছছে…" : "হ্যাঁ, মুছুন"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
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
    ...overrides,
  }
}
