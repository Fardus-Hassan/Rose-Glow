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
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [expensePage, setExpensePage] = useState(1)
  const [expensePageSize, setExpensePageSize] = useState(20)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState("")
  const [productId, setProductId] = useState("")
  const [boughtOn, setBoughtOn] = useState(todayISO)
  const [quantity, setQuantity] = useState("")
  const [unitCost, setUnitCost] = useState("")
  const [note, setNote] = useState("")
  const [spentOn, setSpentOn] = useState(todayISO)
  const [kind, setKind] = useState("vehicle")
  const [amount, setAmount] = useState("")
  const [expenseNote, setExpenseNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [savingExpense, setSavingExpense] = useState(false)

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
    const query = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
      expenseLimit: String(expensePageSize),
      expenseOffset: String((expensePage - 1) * expensePageSize),
    })
    api(`/api/purchases?${query}`)
      .then((body) => {
        if (!live) return
        const pages = Math.max(1, Math.ceil(body.total / pageSize))
        const expensePages = Math.max(1, Math.ceil(body.expenseTotal / expensePageSize))
        if (page > pages) {
          setPage(pages)
          return
        }
        if (expensePage > expensePages) {
          setExpensePage(expensePages)
          return
        }
        applyBooks(body)
        setReady(true)
      })
      .catch((reason) => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [page, pageSize, expensePage, expensePageSize])

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
  }

  function booksQuery(nextPage = page, nextSize = pageSize, nextExpensePage = expensePage, nextExpenseSize = expensePageSize) {
    return new URLSearchParams({
      limit: String(nextSize),
      offset: String((nextPage - 1) * nextSize),
      expenseLimit: String(nextExpenseSize),
      expenseOffset: String((nextExpensePage - 1) * nextExpenseSize),
    })
  }

  function pickProduct(id) {
    setProductId(id)
    const product = products.find((item) => String(item.id) === String(id))
    if (product) setUnitCost(String(product.costPrice))
  }

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError("")
    try {
      await api("/api/purchases", {
        method: "POST",
        body: { productId: Number(productId), boughtOn, quantity: Number(quantity), unitCost: Number(unitCost), note },
      })
      setQuantity("")
      setNote("")
      setPage(1)
      const body = await api(`/api/purchases?${booksQuery(1, pageSize)}`)
      applyBooks(body)
      toast.success("Purchase saved, stock updated")
    } catch (reason) {
      setError(reason.message)
      toast.error(reason.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveExpense(event) {
    event.preventDefault()
    setSavingExpense(true)
    setError("")
    try {
      await api("/api/buying-expenses", {
        method: "POST",
        body: { spentOn, kind, amount: Number(amount), note: expenseNote },
      })
      setAmount("")
      setExpenseNote("")
      setExpensePage(1)
      const body = await api(`/api/purchases?${booksQuery(page, pageSize, 1, expensePageSize)}`)
      applyBooks(body)
      toast.success("Cost saved")
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
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">What you bought</p>
          <h1>Books</h1>
        </div>
        <button type="button" className="btn secondary" onClick={() => go("/inventory")}>Inventory</button>
      </div>
      <p className="lede">Write each buy, and also what it cost to bring the goods in: vehicle, courier, or anything else. Pieces are added to Inventory.</p>
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
        </div>
      </div>

      <form className="card books-form" onSubmit={save}>
        <h2>Add a purchase</h2>
        <div className="books-line">
          <label className="field">
            <span>Date</span>
            <input type="date" value={boughtOn} max={todayISO()} min="2020-01-01" onChange={(event) => setBoughtOn(event.target.value)} required />
          </label>
          <label className="field span-2">
            <span>Product</span>
            <select value={productId} onChange={(event) => pickProduct(event.target.value)} required>
              <option value="">Choose</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Pieces</span>
            <input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
          </label>
          <label className="field">
            <span>Cost each</span>
            <input type="number" min="0" step="1" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} required />
          </label>
          <label className="field span-2">
            <span>Note</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" maxLength={160} />
          </label>
          <button className="btn span-2" type="submit" disabled={saving || !productsReady || products.length === 0}>{saving ? "Saving…" : "Save"}</button>
        </div>
        {productsReady && products.length === 0 ? <p className="muted small">Add the product in Inventory first, then come back and record what you paid.</p> : null}
      </form>

      <form className="card books-form" onSubmit={saveExpense}>
        <h2>Cost of bringing it in</h2>
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
          <label className="field span-2">
            <span>Note</span>
            <input value={expenseNote} onChange={(event) => setExpenseNote(event.target.value)} placeholder="Vehicle fare, courier" maxLength={160} />
          </label>
          <button className="btn span-2" type="submit" disabled={savingExpense}>{savingExpense ? "Saving…" : "Save"}</button>
        </div>
      </form>

      <article className="card">
        <div className="card-head">
          <h2>By day</h2>
        </div>
        {!ready ? <p className="muted">Loading…</p> : null}
        {ready && days.length === 0 ? <Empty title="Nothing recorded yet" text="A purchase or a bringing-in cost shows here with that day's total." /> : null}
        {days.length > 0 ? (
          <ul className="stock-list day-book">
            {days.map((day) => (
              <li key={day.day}>
                <span>{dayLabel(day.day)}</span>
                <small>
                  {day.pieces} pieces
                  {day.expenses > 0 ? ` · bringing in ${taka(day.expenses)}` : ""}
                </small>
                <b>{taka(day.total)}</b>
              </li>
            ))}
          </ul>
        ) : null}
      </article>

      <article className="card list-card purchase-list">
        <div className="card-head">
          <h2>Lines</h2>
        </div>
        {rows.length > 0 ? (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th className="num">Pieces</th>
                  <th className="num">Cost each</th>
                  <th className="num">Total</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Date">{dayLabel(row.boughtOn)}</td>
                    <td data-label="Product"><strong>{row.productName}</strong></td>
                    <td data-label="Pieces" className="num">{row.quantity}</td>
                    <td data-label="Cost each" className="num">{taka(row.unitCost)}</td>
                    <td data-label="Total" className="num">{taka(row.total)}</td>
                    <td data-label="Note">{row.note || "—"}</td>
                    <td data-label=""><button type="button" className="text-btn" onClick={() => remove(row)}>Remove</button></td>
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

      <article className="card list-card expense-list">
        <div className="card-head">
          <h2>Bringing in</h2>
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
                  <tr key={row.id}>
                    <td data-label="Date">{dayLabel(row.spentOn)}</td>
                    <td data-label="What"><strong>{kindLabel(row.kind)}</strong></td>
                    <td data-label="Amount" className="num">{taka(row.amount)}</td>
                    <td data-label="Note">{row.note || "—"}</td>
                    <td data-label=""><button type="button" className="text-btn" onClick={() => removeExpense(row)}>Remove</button></td>
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
