import { useEffect, useLayoutEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import { STATUSES, holdsStock, statusLabel } from "@rose/shared"
import { api } from "../api.js"
import { taka, when } from "../format.js"
import { useRoute } from "../route.jsx"
import { Banner, Empty, LIST_PAGE, Pager, StatusPill } from "../ui.jsx"

const FILTERS = [{ id: "all", label: "সব" }, ...STATUSES]

export default function Orders() {
  const { go } = useRoute()
  const [status, setStatus] = useState("all")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState("")

  function replaceOrder(next) {
    const dropped = status !== "all" && next.status !== status
    if (dropped && data?.orders.length === 1 && page > 1) {
      setPage(page - 1)
      return
    }
    setData((current) => {
      if (!current) return current
      return {
        ...current,
        orders: dropped ? current.orders.filter((item) => item.id !== next.id) : current.orders.map((item) => item.id === next.id ? next : item),
        total: dropped ? Math.max(0, current.total - 1) : current.total,
      }
    })
  }

  function showPage(next) {
    setPage(next)
    document.querySelector(".list-card")?.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  useEffect(() => {
    let live = true
    const handle = setTimeout(() => {
      const query = new URLSearchParams({
        status,
        q,
        limit: String(LIST_PAGE),
        offset: String((page - 1) * LIST_PAGE),
      })
      api(`/api/orders?${query}`)
        .then((body) => {
          if (!live) return
          const pages = Math.max(1, Math.ceil(body.total / LIST_PAGE))
          if (page > pages) {
            setPage(pages)
            return
          }
          setData(body)
          setError("")
        })
        .catch((reason) => { if (live) setError(reason.message) })
    }, 200)
    return () => { live = false; clearTimeout(handle) }
  }, [status, q, page])

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">খোঁজ আর আপডেট</p>
          <h1>সব অর্ডার</h1>
        </div>
        <button type="button" className="btn" onClick={() => go("/orders/new")}>নতুন অর্ডার</button>
      </div>
      <Banner message={error} />
      <div className="filters">
        <div className="filter-pills">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" className={status === item.id ? "pill-btn active" : "pill-btn"} onClick={() => { setStatus(item.id); setPage(1) }}>
              {item.label}
            </button>
          ))}
        </div>
        <input value={q} onChange={(event) => { setQ(event.target.value); setPage(1) }} placeholder="নাম, মোবাইল বা RG নম্বর" />
      </div>

      <article className="card list-card">
        <div className="table-card">
        {!data ? <p className="muted">লোড হচ্ছে…</p> : null}
        {data && data.orders.length === 0 ? <Empty title="কোনো অর্ডার নেই" text="এই খোঁজে কিছু মেলেনি।" /> : null}
        {data && data.orders.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>অর্ডার</th>
                <th>কাস্টমার</th>
                <th>সময়</th>
                <th>স্ট্যাটাস</th>
                <th>মোট</th>
                <th>বাকি</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <tr key={order.id} onClick={() => go(`/orders/${order.id}`)}>
                  <td data-label="অর্ডার"><strong>{order.number}</strong></td>
                  <td data-label="কাস্টমার">
                    {order.customerName}
                    <small>{order.mobile}<br />{order.courier}</small>
                  </td>
                  <td data-label="সময়">{when(order.orderedAt)}</td>
                  <td data-label="স্ট্যাটাস">
                    <StatusMenu order={order} onChanged={replaceOrder} />
                  </td>
                  <td data-label="মোট">{taka(order.total)}</td>
                  <td data-label="বাকি" className={order.due > 0 ? "danger" : ""}>{taka(order.due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        </div>
        {data && data.total > LIST_PAGE ? <Pager page={page} total={data.total} onPage={showPage} /> : null}
        {data && data.total > 0 && data.total <= LIST_PAGE ? <p className="muted small count-line">{data.total}টা অর্ডার</p> : null}
      </article>
    </section>
  )
}

function StatusMenu({ order, onChanged }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [spot, setSpot] = useState(null)
  const box = useRef(null)
  const trigger = useRef(null)

  useLayoutEffect(() => {
    if (!open) return undefined
    function place() {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const width = 168
      const height = 252
      let left = rect.left
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
      if (left < 8) left = 8
      let top = rect.bottom + 6
      if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6)
      setSpot((current) => current && current.top === top && current.left === left ? current : { top, left })
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    function away(event) {
      if (!box.current?.contains(event.target)) setOpen(false)
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", away)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", away)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  async function choose(nextStatus) {
    if (nextStatus === order.status || busy) {
      setOpen(false)
      return
    }
    setBusy(true)
    try {
      const body = await api(`/api/orders/${order.id}`, {
        method: "PATCH",
        body: {
          customerName: order.customerName,
          mobile: order.mobile,
          address: order.address,
          courier: order.courier,
          orderedAt: order.orderedAt,
          status: nextStatus,
          paymentMethod: order.paymentMethod,
          paidAmount: order.paidAmount,
          deliveryCharge: order.deliveryCharge,
          deliveryPaidBy: order.deliveryPaidBy || "customer",
          discount: order.discount,
          codPaidBy: order.codPaidBy || "free",
          codCharge: order.codCharge || 0,
          note: order.note,
        },
      })
      onChanged(body.order)
      const restored = !holdsStock(nextStatus) && holdsStock(order.status)
      toast.success(restored ? `${statusLabel(nextStatus)} হয়েছে। স্টক ফিরে এসেছে।` : `স্ট্যাটাস এখন ${statusLabel(nextStatus)}`)
      setOpen(false)
    } catch (reason) {
      toast.error(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="status-menu" ref={box} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        ref={trigger}
        className={`pill pill-${order.status} status-trigger`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${statusLabel(order.status)}, স্ট্যাটাস বদলান`}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        {statusLabel(order.status)}
        <Caret />
      </button>
      {open && spot ? (
        <ul className="status-pop" role="listbox" style={{ top: spot.top, left: spot.left }}>
          {STATUSES.map((item) => (
            <li key={item.id}>
              <button type="button" className={item.id === order.status ? "active" : ""} role="option" aria-selected={item.id === order.status} onClick={() => choose(item.id)}>
                <StatusPill status={item.id} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Caret() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
