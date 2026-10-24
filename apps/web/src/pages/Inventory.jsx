import { useEffect, useState } from "react"
import { LOW_STOCK_AT } from "@rose/shared"
import { api } from "../api.js"
import { taka } from "../format.js"
import { Banner, Empty, LIST_PAGE, Pager } from "../ui.jsx"

export default function Inventory() {
  const [products, setProducts] = useState(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [productPage, setProductPage] = useState(1)
  const [comboPage, setComboPage] = useState(1)

  async function reload(message) {
    const body = await api("/api/products")
    setProducts(body.products)
    if (message) setNotice(message)
  }

  useEffect(() => {
    let live = true
    api("/api/products")
      .then((body) => { if (live) setProducts(body.products) })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [])

  const singles = products?.filter((item) => !item.isCombo) || []
  const combos = products?.filter((item) => item.isCombo) || []
  const pieces = singles.reduce((sum, item) => sum + item.stockQty, 0)
  const low = singles.filter((item) => item.stockQty <= LOW_STOCK_AT).length
  const shownProducts = singles.slice((productPage - 1) * LIST_PAGE, productPage * LIST_PAGE)
  const shownCombos = combos.slice((comboPage - 1) * LIST_PAGE, comboPage * LIST_PAGE)

  useEffect(() => {
    const pages = Math.max(1, Math.ceil(singles.length / LIST_PAGE) || 1)
    if (productPage > pages) setProductPage(pages)
  }, [singles.length, productPage])

  useEffect(() => {
    const pages = Math.max(1, Math.ceil(combos.length / LIST_PAGE) || 1)
    if (comboPage > pages) setComboPage(pages)
  }, [combos.length, comboPage])

  return (
    <section className="page">
      <div className="page-head inv-head">
        <div>
          <p className="eyebrow">What you have, and how many</p>
          <h1>Inventory</h1>
        </div>
        {products ? (
          <div className="inv-stats">
            <span><b>{singles.length}</b> products</span>
            <span><b>{pieces}</b> pieces</span>
            <span><b className={low ? "warn" : ""}>{low}</b> low stock</span>
            <span><b>{combos.length}</b> combos</span>
          </div>
        ) : null}
      </div>
      <Banner message={notice} tone="good" />
      <Banner message={error} />

      <ProductForm onDone={reload} onError={setError} />

      <article className="card inv-table list-card" id="product-list">
        <div className="card-head">
          <h2>Products</h2>
          <p className="muted small">Stock goes down when an order is saved, and comes back on cancel or return.</p>
        </div>
        {!products ? <p className="muted">Loading…</p> : null}
        {products && singles.length === 0 ? <Empty title="No products yet" text="Add a name, cost, selling price, and how many pieces you brought in." /> : null}
        {singles.length > 0 ? (
          <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Cost</th>
                <th className="num">Sell</th>
                <th className="num">Profit</th>
                <th className="num">Stock</th>
                <th>Add / remove</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shownProducts.map((product) => (
                <ProductRow key={product.id} product={product} onDone={reload} onError={setError} />
              ))}
            </tbody>
          </table>
          </div>
        ) : null}
        <Pager page={productPage} total={singles.length} onPage={(next) => turnPage(setProductPage, next, "product-list")} />
      </article>

      <div className="inv-forms">
        <ComboForm singles={singles} onDone={reload} onError={setError} />
        <article className="card inv-table list-card" id="combo-list">
          <div className="card-head">
            <h2>Combos</h2>
            <p className="muted small">A combo has no stock of its own. It uses the products inside.</p>
          </div>
          {products && combos.length === 0 ? <Empty title="No combos yet" text="Make a combo when you sell two or more pieces together." /> : null}
          {combos.length > 0 ? (
            <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Combo</th>
                  <th className="num">Cost</th>
                  <th className="num">Sell</th>
                  <th className="num">Sets</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shownCombos.map((product) => (
                  <ComboRow key={product.id} product={product} singles={singles} onDone={reload} onError={setError} />
                ))}
              </tbody>
            </table>
            </div>
          ) : null}
          <Pager page={comboPage} total={combos.length} onPage={(next) => turnPage(setComboPage, next, "combo-list")} />
        </article>
      </div>
    </section>
  )
}

function turnPage(setPage, next, id) {
  setPage(next)
  document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })
}

function ProductForm({ onDone, onError }) {
  const [saving, setSaving] = useState(false)
  async function submit(event) {
    event.preventDefault()
    const formEl = event.currentTarget
    const form = new FormData(formEl)
    setSaving(true)
    onError("")
    try {
      await api("/api/products", {
        method: "POST",
        body: {
          name: form.get("name"),
          costPrice: form.get("costPrice"),
          sellPrice: form.get("sellPrice"),
          stockQty: form.get("stockQty") || 0,
        },
      })
      formEl.reset()
      await onDone("Product added")
    } catch (reason) {
      onError(reason.message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <form className="card inv-form" onSubmit={submit}>
      <h2>Add product</h2>
      <div className="inv-line">
        <input name="name" required placeholder="Name" aria-label="Name" />
        <input name="costPrice" type="number" min="0" step="1" required placeholder="Cost" aria-label="Cost price" />
        <input name="sellPrice" type="number" min="0" step="1" required placeholder="Sell" aria-label="Selling price" />
        <input name="stockQty" type="number" min="0" step="1" defaultValue="0" placeholder="Pieces" aria-label="Pieces" />
        <button className="btn" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </form>
  )
}

function ComboForm({ singles, onDone, onError }) {
  const [parts, setParts] = useState([{ productId: "", quantity: 1 }, { productId: "", quantity: 1 }])
  const [saving, setSaving] = useState(false)
  const cost = comboCost(parts, singles)

  async function submit(event) {
    event.preventDefault()
    const formEl = event.currentTarget
    const form = new FormData(formEl)
    setSaving(true)
    onError("")
    try {
      await api("/api/combos", {
        method: "POST",
        body: {
          name: form.get("name"),
          sellPrice: form.get("sellPrice"),
          items: parts.filter((part) => part.productId).map((part) => ({ productId: Number(part.productId), quantity: Number(part.quantity) })),
        },
      })
      formEl.reset()
      setParts([{ productId: "", quantity: 1 }, { productId: "", quantity: 1 }])
      await onDone("Combo created")
    } catch (reason) {
      onError(reason.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="card inv-form" onSubmit={submit}>
      <h2>Make a combo</h2>
      <div className="inv-line short">
        <input name="name" required placeholder="Combo name" aria-label="Combo name" />
        <input name="sellPrice" type="number" min="0" step="1" required placeholder="Sell" aria-label="Selling price" />
        <button className="btn" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
      {parts.map((part, index) => (
        <div className="add-line" key={index}>
          <select aria-label="Combo product" value={part.productId} onChange={(event) => setParts(updatePart(parts, index, { productId: event.target.value }))}>
            <option value="">Product</option>
            {singles.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stockQty}</option>)}
          </select>
          <input aria-label="Combo quantity" type="number" min="1" step="1" value={part.quantity} onChange={(event) => setParts(updatePart(parts, index, { quantity: Number(event.target.value) }))} />
          <button type="button" className="text-btn" onClick={() => setParts(parts.filter((_, item) => item !== index))}>Remove</button>
        </div>
      ))}
      <div className="inv-combo-foot">
        <button type="button" className="text-btn" onClick={() => setParts([...parts, { productId: "", quantity: 1 }])}>Another product</button>
        <span className="muted small">Cost {taka(cost)}</span>
      </div>
    </form>
  )
}

function ProductRow({ product, onDone, onError }) {
  const [editing, setEditing] = useState(false)
  const [delta, setDelta] = useState("")
  const [saving, setSaving] = useState(false)
  const formId = `product-${product.id}`
  const profit = product.sellPrice - product.costPrice

  async function adjust(event) {
    event.preventDefault()
    setSaving(true)
    onError("")
    try {
      await api(`/api/products/${product.id}/stock`, { method: "POST", body: { delta: Number(delta) } })
      setDelta("")
      await onDone("Stock updated")
    } catch (reason) {
      onError(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    onError("")
    try {
      await api(`/api/products/${product.id}`, {
        method: "PATCH",
        body: { name: form.get("name"), costPrice: form.get("costPrice"), sellPrice: form.get("sellPrice") },
      })
      setEditing(false)
      await onDone("Product updated")
    } catch (reason) {
      onError(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${product.name}?`)) return
    onError("")
    try {
      await api(`/api/products/${product.id}`, { method: "DELETE" })
      await onDone("Product deleted")
    } catch (reason) {
      onError(reason.message)
    }
  }

  return (
    <tr className="inv-product">
      <td data-label="Product">
        {editing
          ? <input form={formId} name="name" defaultValue={product.name} required aria-label="Name" />
          : <strong>{product.name}</strong>}
      </td>
      <td data-label="Cost" className="num">
        {editing
          ? <input form={formId} name="costPrice" type="number" min="0" step="1" defaultValue={product.costPrice} required aria-label="Cost price" />
          : taka(product.costPrice)}
      </td>
      <td data-label="Sell" className="num">
        {editing
          ? <input form={formId} name="sellPrice" type="number" min="0" step="1" defaultValue={product.sellPrice} required aria-label="Selling price" />
          : taka(product.sellPrice)}
      </td>
      <td data-label="Profit" className={profit < 0 ? "num danger" : "num"}>{taka(profit)}</td>
      <td data-label="Stock" className="num">
        <b className={product.stockQty === 0 ? "danger" : product.stockQty <= LOW_STOCK_AT ? "warn" : ""}>{product.stockQty}</b>
      </td>
      <td data-label="Add / remove" className={editing ? "inv-skip" : ""}>
        {editing ? null : (
          <form className="adjust" onSubmit={adjust}>
            <input type="number" step="1" value={delta} onChange={(event) => setDelta(event.target.value)} placeholder="+/-" aria-label={`Add or remove ${product.name}`} />
            <button className="btn secondary" type="submit" disabled={saving || delta === ""}>Apply</button>
          </form>
        )}
      </td>
      <td data-label="Actions">
        {editing ? (
          <form id={formId} className="row-actions" onSubmit={save}>
            <button className="btn secondary" type="submit" disabled={saving}>Save</button>
            <button type="button" className="text-btn" onClick={() => setEditing(false)}>Cancel</button>
          </form>
        ) : (
          <div className="row-actions">
            <button type="button" className="text-btn" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="text-btn" onClick={remove}>Delete</button>
          </div>
        )}
      </td>
    </tr>
  )
}

function ComboRow({ product, singles, onDone, onError }) {
  const [open, setOpen] = useState(false)
  const [parts, setParts] = useState(product.components.map((part) => ({ productId: String(part.productId), quantity: part.quantity })))
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setParts(product.components.map((part) => ({ productId: String(part.productId), quantity: part.quantity })))
    setOpen(true)
  }

  async function save(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    onError("")
    try {
      await api(`/api/combos/${product.id}`, {
        method: "PATCH",
        body: {
          name: form.get("name"),
          sellPrice: form.get("sellPrice"),
          items: parts.filter((part) => part.productId).map((part) => ({ productId: Number(part.productId), quantity: Number(part.quantity) })),
        },
      })
      setOpen(false)
      await onDone("Combo updated")
    } catch (reason) {
      onError(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${product.name}?`)) return
    try {
      await api(`/api/products/${product.id}`, { method: "DELETE" })
      await onDone("Combo deleted")
    } catch (reason) {
      onError(reason.message)
    }
  }

  return (
    <>
      <tr className="inv-combo">
        <td data-label="Combo">
          <strong>{product.name}</strong>
          <small>{product.components.map((part) => `${part.name} ×${part.quantity}`).join(" + ")}</small>
        </td>
        <td data-label="Cost" className="num">{taka(product.costPrice)}</td>
        <td data-label="Sell" className="num">{taka(product.sellPrice)}</td>
        <td data-label="Sets" className="num">
          <b className={product.available === 0 ? "danger" : product.available <= LOW_STOCK_AT ? "warn" : ""}>{product.available}</b>
        </td>
        <td data-label="Actions">
          <div className="row-actions">
            <button type="button" className="text-btn" onClick={() => (open ? setOpen(false) : startEdit())}>{open ? "Close" : "Edit"}</button>
            <button type="button" className="text-btn" onClick={remove}>Delete</button>
          </div>
        </td>
      </tr>
      {open ? (
        <tr className="inv-edit">
          <td className="inv-span" colSpan={5}>
            <form className="inv-edit-form" onSubmit={save}>
              <div className="inv-line short">
                <input name="name" defaultValue={product.name} required aria-label="Combo name" />
                <input name="sellPrice" type="number" min="0" step="1" defaultValue={product.sellPrice} required aria-label="Selling price" />
                <button className="btn secondary" type="submit" disabled={saving}>Save</button>
              </div>
              {parts.map((part, index) => (
                <div className="add-line" key={index}>
                  <select aria-label="Combo product" value={part.productId} onChange={(event) => setParts(updatePart(parts, index, { productId: event.target.value }))}>
                    <option value="">Product</option>
                    {singles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.stockQty}</option>)}
                  </select>
                  <input aria-label="Combo quantity" type="number" min="1" step="1" value={part.quantity} onChange={(event) => setParts(updatePart(parts, index, { quantity: Number(event.target.value) }))} />
                  <button type="button" className="text-btn" onClick={() => setParts(parts.filter((_, item) => item !== index))}>Remove</button>
                </div>
              ))}
              <button type="button" className="text-btn" onClick={() => setParts([...parts, { productId: "", quantity: 1 }])}>Another product</button>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function updatePart(parts, index, patch) {
  return parts.map((part, item) => item === index ? { ...part, ...patch } : part)
}

function comboCost(parts, singles) {
  return parts.reduce((sum, part) => {
    const product = singles.find((item) => item.id === Number(part.productId))
    if (!product) return sum
    return sum + product.costPrice * (Number(part.quantity) || 0)
  }, 0)
}
