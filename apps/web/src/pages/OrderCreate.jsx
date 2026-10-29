import { useEffect, useMemo, useState } from "react"
import toast from "react-hot-toast"
import { MANUAL_STATUSES, PAYMENTS } from "@rose/shared"
import { api, fromInputValue, nowInput } from "../api.js"
import { taka, when } from "../format.js"
import { addTo, lineKey, toggleGiftIn } from "../lines.js"
import { useRoute } from "../route.jsx"
import Select, { productOptions } from "../select.jsx"
import { SourceField } from "../sources.jsx"
import { Banner, Field, StatusPill, askConfirm, courierStatusQuestion } from "../ui.jsx"
import { ProductList } from "./Orders.jsx"

function phoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "").replace(/^88(?=01)/, "")
  return /^01\d{9}$/.test(digits) ? digits : ""
}

function PastOrders({ mobile, onFill }) {
  const key = phoneKey(mobile)
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!key) {
      setData(null)
      return undefined
    }
    let live = true
    api(`/api/orders?q=${encodeURIComponent(key)}&limit=5`)
      .then((body) => { if (live) setData(body.total > 0 ? body : null) })
      .catch(() => { if (live) setData(null) })
    return () => { live = false }
  }, [key])

  if (!data) return null
  const counts = Object.fromEntries((data.statusCounts || []).map((row) => [row.id, row.count]))
  const latest = data.orders[0]
  const facts = [
    ["Delivered", counts.delivered || 0, ""],
    ["Returned", counts.returned || 0, "bad"],
    ["Cancelled", counts.cancelled || 0, "bad"],
    ["Open", (counts.new || 0) + (counts.confirmed || 0) + (counts.courier || 0), ""],
  ]
  return (
    <article className="card past-orders">
      <div className="card-head">
        <div>
          <h2>Ordered before</h2>
          <p className="muted small">{data.total} {data.total === 1 ? "order" : "orders"} from this number</p>
        </div>
        <button type="button" className="text-btn" onClick={() => onFill(latest)}>Use last name and address</button>
      </div>
      <div className="past-facts">
        {facts.map(([label, value, tone]) => (
          <p key={label} className={value > 0 && tone ? tone : ""}><span>{label}</span><b>{value}</b></p>
        ))}
      </div>
      <ul className="past-list">
        {data.orders.map((order) => (
          <li key={order.id}>
            <a href={`/orders/${order.id}`} target="_blank" rel="noreferrer" className="past-number">{order.number}</a>
            <small className="muted">{when(order.orderedAt)}</small>
            <ProductList items={order.items} max={2} />
            <StatusPill status={order.status} />
            <b>{taka(order.total)}</b>
          </li>
        ))}
      </ul>
      {data.total > data.orders.length ? (
        <a className="text-btn past-more" href={`/orders?q=${encodeURIComponent(key)}`} target="_blank" rel="noreferrer">See all {data.total}</a>
      ) : null}
    </article>
  )
}

const DEFAULT_COURIER_NOTE = "কাস্টমার ফোন রিসিভ না করলে বা কোনো সমস্যা হলে অবশ্যই মার্চেন্টকে জানাতে হবে। মার্চেন্টকে না জানিয়ে কোনোভাবেই প্রোডাক্ট ফেরত পাঠানো যাবে না।"

export default function OrderCreate() {
  const { go } = useRoute()
  const [products, setProducts] = useState([])
  const [sources, setSources] = useState([])
  const [couriers, setCouriers] = useState([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState([])
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
    note: DEFAULT_COURIER_NOTE,
    privateNote: "",
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
  const goods = lines.reduce((sum, line) => sum + (line.gift ? 0 : line.sellPrice * line.quantity), 0)
  const cost = lines.reduce((sum, line) => sum + line.costPrice * line.quantity, 0)
  const giftCost = lines.reduce((sum, line) => sum + (line.gift ? line.costPrice * line.quantity : 0), 0)
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

  function toggleGift(key) {
    setLines((current) => toggleGiftIn(current, key))
  }

  async function submit(event) {
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
    const question = courierStatusQuestion({ status: "new", courier: form.courier }, form.status)
    if (question && !await askConfirm(question)) return
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
          items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, gift: line.gift })),
        },
      })
      toast.success(`${body.order.number} saved`)
      go(`/orders/${body.order.id}`)
    } catch (reason) {
      setError(reason.message)
      setSaving(false)
    }
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">When a customer orders</p>
          <h1>New order</h1>
        </div>
      </div>
      <form className="order-layout order-create" onSubmit={submit}>
        <div className="stack">
          <Banner message={error} />
          <article className="card">
            <div className="create-grid">
              <Field label="Name">
                <input value={form.customerName} onChange={(event) => set("customerName", event.target.value)} required />
              </Field>
              <Field label="Mobile">
                <input value={form.mobile} onChange={(event) => set("mobile", event.target.value)} inputMode="tel" placeholder="01XXXXXXXXX" required />
              </Field>
              <Field label="Courier">
                <Select
                  label="Courier"
                  value={form.courier}
                  onChange={(value) => set("courier", value)}
                  options={couriers.map((courier) => ({ value: courier.name, label: courier.name }))}
                  placeholder={couriers.length ? "Choose" : "No courier is connected"}
                  required
                />
              </Field>
              <Field label="Status">
                <Select
                  label="Status"
                  value={form.status}
                  onChange={(value) => set("status", value)}
                  options={MANUAL_STATUSES.map((status) => ({ value: status.id, label: status.label }))}
                />
              </Field>
              <SourceField
                value={form.sourceId}
                onChange={(sourceId) => set("sourceId", sourceId)}
                sources={sources}
                onSources={setSources}
                required
              />
              <Field label="Order time" className="span-2">
                <input type="datetime-local" value={form.orderedAt} onChange={(event) => set("orderedAt", event.target.value)} required />
              </Field>
              <Field label="Address" className="wide">
                <textarea rows={3} value={form.address} onChange={(event) => set("address", event.target.value)} required />
              </Field>
            </div>
          </article>

          <PastOrders
            mobile={form.mobile}
            onFill={(order) => setForm((current) => ({ ...current, customerName: order.customerName, address: order.address }))}
          />

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
                options={productOptions(products, (product) => product.isCombo ? `can make ${product.available}` : `in stock ${product.stockQty}`)}
              />
            </div>
            {lines.length === 0 ? <p className="muted small">Add a product.</p> : (
              <ul className="lines create-lines">
                {lines.map((line) => (
                  <li key={lineKey(line)} className={line.gift ? "gift-line" : undefined}>
                    <div>
                      <strong>{line.name}{line.gift ? <span className="gift-tag">Gift</span> : null}</strong>
                      {line.isCombo ? <small>{line.components.map((part) => `${part.name} ×${part.quantity}`).join(", ")}</small> : null}
                      {line.gift ? <small>Your cost {taka(line.costPrice * line.quantity)}</small> : null}
                    </div>
                    <input className="line-qty" aria-label={`${line.name} quantity`} type="number" min="1" step="1" value={line.quantity} onChange={(event) => setLineQty(lineKey(line), event.target.value)} />
                    <b>{line.gift ? "Free" : taka(line.sellPrice * line.quantity)}</b>
                    <div className="line-actions">
                      <button type="button" className={line.gift ? "gift-btn on" : "gift-btn"} aria-pressed={line.gift} onClick={() => toggleGift(lineKey(line))}>{line.gift ? "Gifted" : "Gift"}</button>
                      <button type="button" className="text-btn" onClick={() => setLines((current) => current.filter((item) => lineKey(item) !== lineKey(line)))}>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {shortage ? <p className="banner banner-bad">{products.find((item) => item.id === shortage[0])?.name} does not have enough stock. Available {products.find((item) => item.id === shortage[0])?.stockQty}, need {shortage[1]}.</p> : null}
          </article>
        </div>

        <aside className="card summary">
          <div className="bill-grid">
            <Field label="Discount">
              <input type="number" min="0" step="1" value={form.discount} onChange={(event) => set("discount", event.target.value)} placeholder="0" />
            </Field>
            <Field label="Paid">
              <input type="number" min="0" step="1" value={form.paidAmount} onChange={(event) => set("paidAmount", event.target.value)} placeholder="0" />
            </Field>
          </div>
          <Field label="Payment">
            <Select
              label="Payment"
              value={form.paymentMethod}
              onChange={(value) => set("paymentMethod", value)}
              options={PAYMENTS.map((payment) => ({ value: payment.id, label: payment.label }))}
            />
          </Field>
          <div className="field">
            <span>Delivery</span>
            <div className="cod-row">
              <button type="button" className={form.deliveryPaidBy === "free" ? "pill-btn active" : "pill-btn"} onClick={() => set("deliveryPaidBy", "free")}>Free</button>
              <button type="button" className={form.deliveryPaidBy === "customer" ? "pill-btn active" : "pill-btn"} onClick={() => set("deliveryPaidBy", "customer")}>Customer</button>
              <input type="number" min="0" step="1" value={form.deliveryCharge} onChange={(event) => set("deliveryCharge", event.target.value)} placeholder="Amount" aria-label="Delivery amount" />
            </div>
          </div>
          <Field label="Courier note">
            <textarea rows="2" value={form.note} onChange={(event) => set("note", event.target.value)} placeholder="Goes to Steadfast for the rider" maxLength={400} />
          </Field>
          <Field label="Private note">
            <textarea rows="2" value={form.privateNote} onChange={(event) => set("privateNote", event.target.value)} placeholder="Only you see this" maxLength={1000} />
          </Field>
          <Row label="Products" value={taka(goods)} />
          {giftCost > 0 ? <Row label="Gift (your cost)" value={taka(giftCost)} /> : null}
          <Row label={delivery > 0 && !customerPaysDelivery ? "Delivery (you)" : "Delivery"} value={delivery > 0 ? taka(delivery) : "Free"} />
          <Row label="Total" value={taka(total)} strong />
          <Row label="Due" value={taka(total - paid)} strong />
          <Row label="Profit" value={taka(profit)} strong />
          <button className="btn wide" type="submit" disabled={saving || Boolean(shortage)}>{saving ? "Saving…" : "Save order"}</button>
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
