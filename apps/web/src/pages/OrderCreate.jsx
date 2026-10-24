import { useEffect, useMemo, useState } from "react"
import toast from "react-hot-toast"
import { PAYMENTS, STATUSES } from "@rose/shared"
import { api, fromInputValue, nowInput } from "../api.js"
import { taka } from "../format.js"
import { useRoute } from "../route.jsx"
import { SourceField } from "../sources.jsx"
import { Banner, Field } from "../ui.jsx"

export default function OrderCreate() {
  const { go } = useRoute()
  const [products, setProducts] = useState([])
  const [sources, setSources] = useState([])
  const [couriers, setCouriers] = useState([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState("")
  const [pickQty, setPickQty] = useState(1)
  const [lines, setLines] = useState([])
  const [form, setForm] = useState({
    customerName: "",
    mobile: "",
    address: "",
    courier: "",
    status: "new",
    orderedAt: nowInput(),
    deliveryCharge: "",
    deliveryPaidBy: "free",
    discount: "",
    paidAmount: "",
    paymentMethod: "cod",
    note: "",
    sourceId: "",
  })

  useEffect(() => {
    let live = true
    Promise.all([api("/api/products"), api("/api/sources"), api("/api/courier/active")])
      .then(([catalog, sourceBody, courierBody]) => {
        if (!live) return
        setProducts(catalog.products)
        setSources(sourceBody.sources)
        setCouriers(courierBody.couriers)
        setForm((current) => {
          const next = { ...current }
          if (!current.sourceId && sourceBody.sources[0]) next.sourceId = String(sourceBody.sources[0].id)
          const names = courierBody.couriers.map((item) => item.name)
          if (!names.includes(current.courier)) next.courier = names[0] || ""
          return next
        })
      })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [])

  const needs = useMemo(() => requiredPieces(lines, products), [lines, products])
  const shortage = [...needs].find(([productId, quantity]) => {
    const product = products.find((item) => item.id === productId)
    return product && product.stockQty < quantity
  })
  const goods = lines.reduce((sum, line) => sum + line.sellPrice * line.quantity, 0)
  const cost = lines.reduce((sum, line) => sum + line.costPrice * line.quantity, 0)
  const discount = numberOrZero(form.discount)
  const delivery = numberOrZero(form.deliveryCharge)
  const paid = numberOrZero(form.paidAmount)
  const customerPaysDelivery = form.deliveryPaidBy === "customer"
  const deliveryOnBill = customerPaysDelivery ? delivery : 0
  const total = goods - discount + deliveryOnBill
  const profit = goods - discount - cost - (customerPaysDelivery ? 0 : delivery)

  function set(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function addLine() {
    const product = products.find((item) => item.id === Number(pick))
    const quantity = Number(pickQty)
    if (!product || !Number.isInteger(quantity) || quantity <= 0) {
      setError("পণ্য আর পিস ঠিকমতো বেছে নিন")
      return
    }
    setError("")
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id)
      if (existing) {
        return current.map((line) => line.productId === product.id ? { ...line, quantity: line.quantity + quantity } : line)
      }
      return [...current, {
        productId: product.id,
        name: product.name,
        quantity,
        sellPrice: product.sellPrice,
        costPrice: product.costPrice,
        isCombo: product.isCombo,
        components: product.components,
      }]
    })
    setPick("")
    setPickQty(1)
  }

  function setLineQty(productId, value) {
    const quantity = Number(value)
    if (!Number.isInteger(quantity) || quantity <= 0) return
    setLines((current) => current.map((line) => line.productId === productId ? { ...line, quantity } : line))
  }

  async function submit(event) {
    event.preventDefault()
    if (!lines.length) {
      setError("অন্তত একটা পণ্য যোগ করুন")
      return
    }
    if (shortage) {
      const product = products.find((item) => item.id === shortage[0])
      setError(`${product?.name || "পণ্য"} পর্যাপ্ত নেই`)
      return
    }
    setSaving(true)
    setError("")
    try {
      const body = await api("/api/orders", {
        method: "POST",
        body: {
          ...form,
          orderedAt: fromInputValue(form.orderedAt),
          deliveryCharge: delivery,
          deliveryPaidBy: form.deliveryPaidBy,
          discount,
          paidAmount: paid,
          codPaidBy: "free",
          codCharge: 0,
          items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
        },
      })
      toast.success(`${body.order.number} সেভ হয়েছে`)
      go(`/orders/${body.order.id}`)
    } catch (reason) {
      setError(reason.message)
      setSaving(false)
    }
  }

  const singles = products.filter((item) => !item.isCombo)
  const combos = products.filter((item) => item.isCombo)

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">কাস্টমার অর্ডার করলে</p>
          <h1>নতুন অর্ডার</h1>
        </div>
      </div>
      <form className="order-layout order-create" onSubmit={submit}>
        <div className="stack">
          <Banner message={error} />
          <article className="card">
            <div className="create-grid">
              <Field label="নাম">
                <input value={form.customerName} onChange={(event) => set("customerName", event.target.value)} required />
              </Field>
              <Field label="মোবাইল">
                <input value={form.mobile} onChange={(event) => set("mobile", event.target.value)} inputMode="tel" placeholder="01XXXXXXXXX" required />
              </Field>
              <Field label="কুরিয়ার">
                <select value={form.courier} onChange={(event) => set("courier", event.target.value)} required>
                  {couriers.length === 0 ? <option value="">কোনো কুরিয়ার চালু নেই</option> : null}
                  {couriers.map((courier) => <option key={courier.id} value={courier.name}>{courier.name}</option>)}
                </select>
              </Field>
              <Field label="স্ট্যাটাস">
                <select value={form.status} onChange={(event) => set("status", event.target.value)}>
                  {STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
                </select>
              </Field>
              <SourceField
                value={form.sourceId}
                onChange={(sourceId) => set("sourceId", sourceId)}
                sources={sources}
                onSources={setSources}
                required
              />
              <Field label="অর্ডারের সময়" className="span-2">
                <input type="datetime-local" value={form.orderedAt} onChange={(event) => set("orderedAt", event.target.value)} required />
              </Field>
              <Field label="ঠিকানা" className="wide">
                <textarea rows={3} value={form.address} onChange={(event) => set("address", event.target.value)} required />
              </Field>
            </div>
          </article>

          <article className="card">
            <div className="add-line">
              <select value={pick} onChange={(event) => setPick(event.target.value)} aria-label="পণ্য">
                <option value="">পণ্য বেছে নিন</option>
                <optgroup label="পণ্য">
                  {singles.map((product) => (
                    <option key={product.id} value={product.id}>{product.name} · আছে {product.stockQty}</option>
                  ))}
                </optgroup>
                {combos.length ? (
                  <optgroup label="কম্বো">
                    {combos.map((product) => (
                      <option key={product.id} value={product.id}>{product.name} · বানানো যাবে {product.available}</option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <input aria-label="পিস" type="number" min="1" step="1" value={pickQty} onChange={(event) => setPickQty(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLine() } }} />
              <button type="button" className="btn secondary" onClick={addLine}>যোগ</button>
            </div>
            {lines.length === 0 ? <p className="muted small">পণ্য যোগ করুন।</p> : (
              <ul className="lines create-lines">
                {lines.map((line) => (
                  <li key={line.productId}>
                    <div>
                      <strong>{line.name}</strong>
                      {line.isCombo ? <small>{line.components.map((part) => `${part.name} ×${part.quantity}`).join(", ")}</small> : null}
                    </div>
                    <input className="line-qty" aria-label={`${line.name} পিস`} type="number" min="1" step="1" value={line.quantity} onChange={(event) => setLineQty(line.productId, event.target.value)} />
                    <b>{taka(line.sellPrice * line.quantity)}</b>
                    <button type="button" className="text-btn" onClick={() => setLines((current) => current.filter((item) => item.productId !== line.productId))}>বাদ</button>
                  </li>
                ))}
              </ul>
            )}
            {shortage ? <p className="banner banner-bad">{products.find((item) => item.id === shortage[0])?.name} পর্যাপ্ত নেই। আছে {products.find((item) => item.id === shortage[0])?.stockQty} পিস, লাগবে {shortage[1]} পিস।</p> : null}
          </article>
        </div>

        <aside className="card summary">
          <div className="bill-grid">
            <Field label="ডিসকাউন্ট">
              <input type="number" min="0" step="1" value={form.discount} onChange={(event) => set("discount", event.target.value)} placeholder="0" />
            </Field>
            <Field label="জমা">
              <input type="number" min="0" step="1" value={form.paidAmount} onChange={(event) => set("paidAmount", event.target.value)} placeholder="0" />
            </Field>
          </div>
          <Field label="পেমেন্ট">
            <select value={form.paymentMethod} onChange={(event) => set("paymentMethod", event.target.value)}>
              {PAYMENTS.map((payment) => <option key={payment.id} value={payment.id}>{payment.label}</option>)}
            </select>
          </Field>
          <div className="field">
            <span>ডেলিভারি</span>
            <div className="cod-row">
              <button type="button" className={form.deliveryPaidBy === "free" ? "pill-btn active" : "pill-btn"} onClick={() => set("deliveryPaidBy", "free")}>ফ্রি</button>
              <button type="button" className={form.deliveryPaidBy === "customer" ? "pill-btn active" : "pill-btn"} onClick={() => set("deliveryPaidBy", "customer")}>কাস্টমার</button>
              <input type="number" min="0" step="1" value={form.deliveryCharge} onChange={(event) => set("deliveryCharge", event.target.value)} placeholder="টাকা" aria-label="ডেলিভারি টাকা" />
            </div>
          </div>
          <Field label="নোট">
            <input value={form.note} onChange={(event) => set("note", event.target.value)} placeholder="চাইলে লিখুন" />
          </Field>
          <Row label="পণ্য" value={taka(goods)} />
          <Row label={delivery > 0 && !customerPaysDelivery ? "ডেলিভারি (আপনি)" : "ডেলিভারি"} value={delivery > 0 ? taka(delivery) : "ফ্রি"} />
          <Row label="মোট" value={taka(total)} strong />
          <Row label="বাকি" value={taka(total - paid)} strong />
          <Row label="লাভ" value={taka(profit)} strong />
          <button className="btn wide" type="submit" disabled={saving || Boolean(shortage)}>{saving ? "সেভ হচ্ছে…" : "অর্ডার সেভ"}</button>
        </aside>
      </form>
    </section>
  )
}

function Row({ label, value, strong }) {
  return (
    <p className={strong ? "sum strong" : "sum"}>
      <span>{label}</span>
      <b>{value}</b>
    </p>
  )
}

function numberOrZero(value) {
  if (value === "" || value === null || value === undefined) return 0
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
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
