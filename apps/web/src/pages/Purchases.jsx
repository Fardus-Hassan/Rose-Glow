import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { api } from "../api.js"
import { todayISO } from "../dates.js"
import { dayLabel, taka } from "../format.js"
import { useRoute } from "../route.jsx"
import { Banner, Empty, Pager } from "../ui.jsx"

const PAGE_SIZES = [10, 20, 50, 100, 200]
const EXPENSE_KINDS = [
  { id: "vehicle", label: "Vehicle" },
  { id: "courier", label: "Courier" },
  { id: "other", label: "Other" },
]

function kindLabel(id) {
  return EXPENSE_KINDS.find((item) => item.id === id)?.label || id
}

function periodText(start, end) {
  if (start && end) return `${dayLabel(start)} – ${dayLabel(end)}`
  if (start) return `From ${dayLabel(start)}`
  if (end) return `Up to ${dayLabel(end)}`
  return ""
}

export default function Purchases() {
  const { go } = useRoute()
  const [products, setProducts] = useState([])
  const [productsReady, setProductsReady] = useState(false)
  const [rows, setRows] = useState([])
  const [expenses, setExpenses] = useState([])
  const [days, setDays] = useState([])
  const [total, setTotal] = useState(0)
  const [expenseTotal, setExpenseTotal] = useState(0)
  const [goods, setGoods] = useState(0)
  const [expenseSum, setExpenseSum] = useState(0)
  const [sales, setSales] = useState(0)
  const [profit, setProfit] = useState(0)
  const [adSpend, setAdSpend] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [expensePage, setExpensePage] = useState(1)
  const [expensePageSize, setExpensePageSize] = useState(20)
  const [placePage, setPlacePage] = useState(1)
  const [placePageSize, setPlacePageSize] = useState(10)
  const [placeTotal, setPlaceTotal] = useState(0)
  const [dayPage, setDayPage] = useState(1)
  const [dayPageSize, setDayPageSize] = useState(10)
  const [dayTotal, setDayTotal] = useState(0)
  const [fromDraft, setFromDraft] = useState("")
  const [toDraft, setToDraft] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [match, setMatch] = useState({ lines: 0, pieces: 0, goods: 0 })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState("")
  const [productId, setProductId] = useState("")
  const [boughtOn, setBoughtOn] = useState(todayISO)
  const [quantity, setQuantity] = useState("")
  const [unitCost, setUnitCost] = useState("")
  const [note, setNote] = useState("")
  const [boughtFrom, setBoughtFrom] = useState("")
  const [places, setPlaces] = useState([])
  const [spentOn, setSpentOn] = useState(todayISO)
  const [kind, setKind] = useState("vehicle")
  const [amount, setAmount] = useState("")
  const [expenseNote, setExpenseNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [savingExpense, setSavingExpense] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingExpenseId, setEditingExpenseId] = useState(null)

  useEffect(() => {
    let live = true
    api("/api/products")
      .then((body) => {
        if (!live) return
        setProducts((body.products || []).filter((item) => !item.isCombo))
        setProductsReady(true)
      })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    api(`/api/purchases?${booksQuery()}`)
      .then((body) => {
        if (!live) return
        const pages = Math.max(1, Math.ceil(body.total / pageSize))
        const expensePages = Math.max(1, Math.ceil(body.expenseTotal / expensePageSize))
        const placePages = Math.max(1, Math.ceil((body.placeTotal || 0) / placePageSize))
        const dayPages = Math.max(1, Math.ceil((body.dayTotal || 0) / dayPageSize))
        if (page > pages || expensePage > expensePages || placePage > placePages || dayPage > dayPages) {
          if (page > pages) setPage(pages)
          if (expensePage > expensePages) setExpensePage(expensePages)
          if (placePage > placePages) setPlacePage(placePages)
          if (dayPage > dayPages) setDayPage(dayPages)
          return
        }
        applyBooks(body)
        setReady(true)
      })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [page, pageSize, expensePage, expensePageSize, placePage, placePageSize, dayPage, dayPageSize, from, to])

  function applyBooks(body) {
    setRows(body.purchases)
    setExpenses(body.expenses)
    setDays(body.days)
    setTotal(body.total)
    setExpenseTotal(body.expenseTotal)
    setGoods(body.goods)
    setExpenseSum(body.expensesTotal)
    setSales(body.sales)
    setProfit(body.profit)
    setAdSpend(body.ads || 0)
    setPlaces(body.places || [])
    setPlaceTotal(body.placeTotal || 0)
    setDayTotal(body.dayTotal || 0)
    setMatch(body.match || { lines: 0, pieces: 0, goods: 0 })
  }

  function booksQuery(overrides = {}) {
    const nextPage = overrides.page ?? page
    const nextSize = overrides.pageSize ?? pageSize
    const nextExpensePage = overrides.expensePage ?? expensePage
    const nextExpenseSize = overrides.expensePageSize ?? expensePageSize
    const nextPlacePage = overrides.placePage ?? placePage
    const nextPlaceSize = overrides.placePageSize ?? placePageSize
    const nextDayPage = overrides.dayPage ?? dayPage
    const nextDaySize = overrides.dayPageSize ?? dayPageSize
    const nextFrom = overrides.from ?? from
    const nextTo = overrides.to ?? to
    const query = new URLSearchParams({
      limit: String(nextSize),
      offset: String((nextPage - 1) * nextSize),
      expenseLimit: String(nextExpenseSize),
      expenseOffset: String((nextExpensePage - 1) * nextExpenseSize),
      placeLimit: String(nextPlaceSize),
      placeOffset: String((nextPlacePage - 1) * nextPlaceSize),
      dayLimit: String(nextDaySize),
      dayOffset: String((nextDayPage - 1) * nextDaySize),
    })
    if (nextFrom) query.set("from", nextFrom)
    if (nextTo) query.set("to", nextTo)
    return query
  }

  function lookup(event) {
    event.preventDefault()
    let start = fromDraft
    let end = toDraft
    if (start && end && start > end) {
      const swap = start
      start = end
      end = swap
      setFromDraft(start)
      setToDraft(end)
    }
    setFrom(start)
    setTo(end)
    setPage(1)
    setPlacePage(1)
    setDayPage(1)
    document.querySelector(".lookup-results")?.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  function clearLookup() {
    setFromDraft("")
    setToDraft("")
    setFrom("")
    setTo("")
    setPage(1)
    setPlacePage(1)
    setDayPage(1)
  }

  function pickProduct(id) {
    setProductId(id)
    const product = products.find((item) => String(item.id) === String(id))
    if (product) setUnitCost(String(product.costPrice))
  }

  function clearPurchaseForm() {
    setEditingId(null)
    setProductId("")
    setBoughtOn(todayISO())
    setQuantity("")
    setUnitCost("")
    setNote("")
    setBoughtFrom("")
  }

  function editPurchase(row) {
    setEditingId(row.id)
    setProductId(String(row.productId))
    setBoughtOn(row.boughtOn)
    setQuantity(String(row.quantity))
    setUnitCost(String(row.unitCost))
    setNote(row.note || "")
    setBoughtFrom(row.boughtFrom || "")
    document.querySelector(".buy-form")?.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError("")
    const payload = { productId: Number(productId), boughtOn, quantity: Number(quantity), unitCost: Number(unitCost), note, boughtFrom }
    const wasEditing = Boolean(editingId)
    try {
      if (wasEditing) await api(`/api/purchases/${editingId}`, { method: "PATCH", body: payload })
      else await api("/api/purchases", { method: "POST", body: payload })
      if (!wasEditing) setPage(1)
      clearPurchaseForm()
      const body = await api(`/api/purchases?${booksQuery(wasEditing ? {} : { page: 1 })}`)
      applyBooks(body)
      const outside = (from && boughtOn < from) || (to && boughtOn > to)
      if (wasEditing) toast.success(outside ? "Purchase updated. It sits outside these dates." : "Purchase updated")
      else toast.success(outside ? "Purchase saved. It sits outside these dates." : "Purchase saved, stock updated")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  function clearExpenseForm() {
    setEditingExpenseId(null)
    setSpentOn(todayISO())
    setKind("vehicle")
    setAmount("")
    setExpenseNote("")
  }

  function editExpense(row) {
    setEditingExpenseId(row.id)
    setSpentOn(row.spentOn)
    setKind(row.kind)
    setAmount(String(row.amount))
    setExpenseNote(row.note || "")
    document.querySelector(".expense-form")?.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  async function saveExpense(event) {
    event.preventDefault()
    setSavingExpense(true)
    setError("")
    const payload = { spentOn, kind, amount: Number(amount), note: expenseNote }
    const wasEditing = Boolean(editingExpenseId)
    try {
      if (wasEditing) await api(`/api/buying-expenses/${editingExpenseId}`, { method: "PATCH", body: payload })
      else await api("/api/buying-expenses", { method: "POST", body: payload })
      if (!wasEditing) setExpensePage(1)
      clearExpenseForm()
      const body = await api(`/api/purchases?${booksQuery(wasEditing ? {} : { expensePage: 1 })}`)
      applyBooks(body)
      toast.success(wasEditing ? "Cost updated" : "Cost saved")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSavingExpense(false)
    }
  }

  async function removeExpense(row) {
    if (!window.confirm(`Remove this ${kindLabel(row.kind).toLowerCase()} cost of ${taka(row.amount)}?`)) return
    setError("")
    try {
      await api(`/api/buying-expenses/${row.id}`, { method: "DELETE" })
      if (editingExpenseId === row.id) clearExpenseForm()
      const body = await api(`/api/purchases?${booksQuery()}`)
      const pages = Math.max(1, Math.ceil(body.expenseTotal / expensePageSize))
      if (expensePage > pages) setExpensePage(pages)
      applyBooks(body)
      toast.success("Cost removed")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    }
  }

  async function remove(row) {
    if (!window.confirm(`Remove this purchase of ${row.productName}? Stock will go down by ${row.quantity}.`)) return
    setError("")
    try {
      await api(`/api/purchases/${row.id}`, { method: "DELETE" })
      if (editingId === row.id) clearPurchaseForm()
      const body = await api(`/api/purchases?${booksQuery()}`)
      const pages = Math.max(1, Math.ceil(body.total / pageSize))
      if (page > pages) setPage(pages)
      applyBooks(body)
      toast.success("Purchase removed")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    }
  }

  return (
    <section className="page books-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">What you bought</p>
          <h1>Books</h1>
        </div>
        <button type="button" className="btn secondary" onClick={() => go("/inventory")}>Inventory</button>
      </div>
      <p className="lede">Each buy adds pieces to Inventory. A bringing-in cost is the fare, not more pieces.</p>
      <Banner message={error} />

      <div className="stock-kpis books-kpis">
        <div>
          <span>Goods</span>
          <strong>{taka(goods)}</strong>
        </div>
        <div>
          <span>Bringing in</span>
          <strong>{taka(expenseSum)}</strong>
        </div>
        <div>
          <span>Sold</span>
          <strong>{taka(sales)}</strong>
        </div>
        <div>
          <span>Profit</span>
          <strong>{taka(profit)}</strong>
          {adSpend > 0 ? <small className="muted">Ads {taka(adSpend)} taken out</small> : null}
        </div>
      </div>

      <div className="books-entry">
      <form className="card books-form buy-form" onSubmit={save}>
        <h2>{editingId ? "Edit this purchase" : "Add a purchase"}</h2>
        <div className="books-line buy">
          <label className="field">
            <span>Date</span>
            <input type="date" value={boughtOn} max={todayISO()} min="2020-01-01" onChange={(event) => setBoughtOn(event.target.value)} required />
          </label>
          <label className="field">
            <span>Product</span>
            <select value={productId} onChange={(event) => pickProduct(event.target.value)} required>
              <option value="">Choose</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>From</span>
            <input value={boughtFrom} onChange={(event) => setBoughtFrom(event.target.value)} placeholder="Shop or person" maxLength={80} />
          </label>
          <label className="field">
            <span>Pieces</span>
            <input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
          </label>
          <label className="field">
            <span>Cost each</span>
            <input type="number" min="0" step="1" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} required />
          </label>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={saving || !productsReady || products.length === 0}>{saving ? "Saving…" : editingId ? "Update" : "Save"}</button>
            {editingId ? <button className="btn secondary" type="button" onClick={clearPurchaseForm}>Cancel</button> : null}
          </div>
          <label className="field wide">
            <span>Note</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" maxLength={160} />
          </label>
        </div>
        {productsReady && products.length === 0 ? <p className="muted small">Add the product in Inventory first, then come back and record what you paid.</p> : null}
      </form>

      <form className="card books-form expense-form" onSubmit={saveExpense}>
        <h2>{editingExpenseId ? "Edit this cost" : "Bringing it in"}</h2>
        <div className="books-line expense">
          <label className="field">
            <span>Date</span>
            <input type="date" value={spentOn} max={todayISO()} min="2020-01-01" onChange={(event) => setSpentOn(event.target.value)} required />
          </label>
          <label className="field">
            <span>What</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              {EXPENSE_KINDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Amount</span>
            <input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </label>
          <label className="field">
            <span>Note</span>
            <input value={expenseNote} onChange={(event) => setExpenseNote(event.target.value)} placeholder="Vehicle fare, courier" maxLength={160} />
          </label>
          <div className="form-actions wide">
            <button className="btn" type="submit" disabled={savingExpense}>{savingExpense ? "Saving…" : editingExpenseId ? "Update" : "Save"}</button>
            {editingExpenseId ? <button className="btn secondary" type="button" onClick={clearExpenseForm}>Cancel</button> : null}
          </div>
        </div>
      </form>
      </div>

      <form className="card books-lookup" onSubmit={lookup}>
        <div className="lookup-bar">
          <div className="lookup-title">
            <h2>Look up</h2>
            <p className="muted small">{from || to ? periodText(from, to) : "What you bought, the money, and the place."}</p>
          </div>
          <label className="field">
            <span>Start</span>
            <input type="date" value={fromDraft} max={todayISO()} min="2020-01-01" onChange={(event) => setFromDraft(event.target.value)} />
          </label>
          <label className="field">
            <span>End</span>
            <input type="date" value={toDraft} max={todayISO()} min="2020-01-01" onChange={(event) => setToDraft(event.target.value)} />
          </label>
          <button className="btn" type="submit">Search</button>
          {from || to || fromDraft || toDraft ? <button className="btn secondary" type="button" onClick={clearLookup}>Clear</button> : null}
        </div>
        {from || to ? (
          <div className="stock-kpis range-kpis">
            <div>
              <span>Buys</span>
              <strong>{match.lines}</strong>
            </div>
            <div>
              <span>Pieces</span>
              <strong>{match.pieces}</strong>
            </div>
            <div>
              <span>Goods</span>
              <strong>{taka(match.goods)}</strong>
            </div>
            <div>
              <span>Places</span>
              <strong>{placeTotal}</strong>
            </div>
          </div>
        ) : null}
      </form>

      <div className="lookup-results">
      <div className="books-side">
      <article className="card day-list">
        <div className="card-head">
          <h2>By day</h2>
        </div>
        {!ready ? <p className="muted">Loading…</p> : null}
        {ready && days.length === 0 ? <Empty title="Nothing recorded yet" text={from || to ? "No purchase or bringing-in cost in these dates." : "A purchase or a bringing-in cost shows here with that day's total."} /> : null}
        {days.length > 0 ? (
          <ul className="stock-list day-book">
            {days.map((day) => (
              <li key={day.day}>
                <span>{dayLabel(day.day)}</span>
                <small>
                  {[
                    day.pieces > 0 ? `${day.pieces} ${day.pieces === 1 ? "piece" : "pieces"}` : "",
                    day.expenses > 0 ? `bringing in ${taka(day.expenses)}` : "",
                  ].filter(Boolean).join(" · ")}
                </small>
                <b>{taka(day.total)}</b>
              </li>
            ))}
          </ul>
        ) : null}
        {dayTotal > dayPageSize ? (
          <Pager
            page={dayPage}
            total={dayTotal}
            pageSize={dayPageSize}
            pageSizes={PAGE_SIZES}
            onPage={(next) => {
              setDayPage(next)
              document.querySelector(".day-list")?.scrollIntoView({ block: "start", behavior: "smooth" })
            }}
            onPageSize={(next) => { setDayPageSize(next); setDayPage(1) }}
          />
        ) : null}
      </article>

      {places.length > 0 || from || to ? (
        <article className="card place-list">
          <div className="card-head">
            <h2>Places</h2>
          </div>
          {places.length === 0 ? <Empty title="No place written" text="These buys have no shop, market, or person yet." /> : null}
          {places.length > 0 ? (
            <ul className="stock-list">
              {places.map((place) => (
                <li key={place.place}>
                  <span>{place.place}</span>
                  <small>{place.lines} {place.lines === 1 ? "buy" : "buys"}</small>
                  <b>{taka(place.total)}</b>
                </li>
              ))}
            </ul>
          ) : null}
          {placeTotal > placePageSize ? (
            <Pager
              page={placePage}
              total={placeTotal}
              pageSize={placePageSize}
              pageSizes={PAGE_SIZES}
              onPage={(next) => {
                setPlacePage(next)
                document.querySelector(".place-list")?.scrollIntoView({ block: "start", behavior: "smooth" })
              }}
              onPageSize={(next) => { setPlacePageSize(next); setPlacePage(1) }}
            />
          ) : null}
        </article>
      ) : null}
      </div>

      <article className="card purchase-list">
        <div className="card-head">
          <h2>Lines</h2>
          {ready ? <p className="muted small">{match.lines} {match.lines === 1 ? "buy" : "buys"} · {taka(match.goods)}</p> : null}
        </div>
        {ready && rows.length === 0 ? (
          <Empty
            title={from || to ? "Nothing in these dates" : "No purchases yet"}
            text={from || to ? "Change the start or end date, or clear the search to see every buy." : "Save a purchase and it will show here."}
          />
        ) : null}
        {rows.length > 0 ? (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>From</th>
                  <th className="num">Pieces</th>
                  <th className="num">Cost each</th>
                  <th className="num">Total</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={editingId === row.id ? "selected" : undefined}>
                    <td data-label="Date">{dayLabel(row.boughtOn)}</td>
                    <td data-label="Product"><strong>{row.productName}</strong></td>
                    <td data-label="From">{row.boughtFrom || "—"}</td>
                    <td data-label="Pieces" className="num">{row.quantity}</td>
                    <td data-label="Cost each" className="num">{taka(row.unitCost)}</td>
                    <td data-label="Total" className="num">{taka(row.total)}</td>
                    <td data-label="Note">{row.note || "—"}</td>
                    <td data-label="">
                      <div className="row-actions">
                        <button type="button" className="text-btn" onClick={() => editPurchase(row)}>Edit</button>
                        <button type="button" className="text-btn danger" onClick={() => remove(row)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {ready && total > 0 ? (
          <Pager
            page={page}
            total={total}
            pageSize={pageSize}
            pageSizes={PAGE_SIZES}
            onPage={(next) => {
              setPage(next)
              document.querySelector(".purchase-list")?.scrollIntoView({ block: "start", behavior: "smooth" })
            }}
            onPageSize={(next) => { setPageSize(next); setPage(1) }}
          />
        ) : null}
      </article>
      </div>

      <article className="card expense-list">
        <div className="card-head">
          <h2>Bringing in</h2>
          {ready ? <p className="muted small">{expenseTotal} {expenseTotal === 1 ? "cost" : "costs"} · {taka(expenseSum)}</p> : null}
        </div>
        {ready && expenseTotal === 0 ? <p className="muted">No vehicle, courier, or other cost yet.</p> : null}
        {expenses.length > 0 ? (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th className="num">Amount</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((row) => (
                  <tr key={row.id} className={editingExpenseId === row.id ? "selected" : undefined}>
                    <td data-label="Date">{dayLabel(row.spentOn)}</td>
                    <td data-label="What"><strong>{kindLabel(row.kind)}</strong></td>
                    <td data-label="Amount" className="num">{taka(row.amount)}</td>
                    <td data-label="Note">{row.note || "—"}</td>
                    <td data-label="">
                      <div className="row-actions">
                        <button type="button" className="text-btn" onClick={() => editExpense(row)}>Edit</button>
                        <button type="button" className="text-btn danger" onClick={() => removeExpense(row)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {ready && expenseTotal > 0 ? (
          <Pager
            page={expensePage}
            total={expenseTotal}
            pageSize={expensePageSize}
            pageSizes={PAGE_SIZES}
            onPage={(next) => {
              setExpensePage(next)
              document.querySelector(".expense-list")?.scrollIntoView({ block: "start", behavior: "smooth" })
            }}
            onPageSize={(next) => { setExpensePageSize(next); setExpensePage(1) }}
          />
        ) : null}
      </article>
    </section>
  )
}
