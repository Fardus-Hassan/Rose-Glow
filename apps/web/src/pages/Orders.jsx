import { useEffect, useLayoutEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import { COURIER_STATUSES, MANUAL_STATUSES, courierStatusLabel, holdsStock, statusLabel } from "@rose/shared"
import { api } from "../api.js"
import { taka, when } from "../format.js"
import { useRoute } from "../route.jsx"
import DateRange from "../DateRange.jsx"
import { ParcelEye } from "../ParcelModal.jsx"
import { Banner, CopyText, Empty, Pager, StatusPill } from "../ui.jsx"

const FILTERS = [{ id: "all", label: "All" }, ...MANUAL_STATUSES]
const PAGE_SIZES = [10, 20, 50, 100, 200]

function matchesFilter(order, filter) {
  if (filter === "all") return true
  if (filter.startsWith("sf:")) return order.courierStatus === filter.slice(3)
  return order.status === filter
}

export default function Orders() {
  const { go } = useRoute()
  const [status, setStatus] = useState("all")
  const [source, setSource] = useState("all")
  const [range, setRange] = useState(null)
  const [sources, setSources] = useState([])
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [data, setData] = useState(null)
  const [courierFilters, setCourierFilters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  function replaceOrder(next) {
    const dropped = !matchesFilter(next, status)
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
    setLoading(true)
    setError("")
    const handle = setTimeout(() => {
      const query = new URLSearchParams({
        status,
        source,
        q,
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      })
      if (range?.from && range?.to) {
        query.set("from", range.from)
        query.set("to", range.to)
      }
      api(`/api/orders?${query}`)
        .then((body) => {
          if (!live) return
          const pages = Math.max(1, Math.ceil(body.total / pageSize))
          if (page > pages) {
            setPage(pages)
            return
          }
          setData(body)
          setCourierFilters(body.courierFilters || [])
        })
        .catch((reason) => { if (live) setError(reason.message) })
        .finally(() => { if (live) setLoading(false) })
    }, 200)
    return () => { live = false; clearTimeout(handle) }
  }, [status, source, range, q, page, pageSize])

  useEffect(() => {
    let live = true
    api("/api/sources")
      .then((body) => { if (live) setSources(body.sources) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  const knownIds = Object.keys(COURIER_STATUSES)
  const extraIds = courierFilters.map((item) => item.id).filter((id) => !COURIER_STATUSES[id])
  const selectedId = status.startsWith("sf:") ? status.slice(3) : ""
  const courierPills = selectedId && !knownIds.includes(selectedId) && !extraIds.includes(selectedId)
    ? [...knownIds, ...extraIds, selectedId]
    : [...knownIds, ...extraIds]

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Search and updates</p>
          <h1>All orders</h1>
        </div>
        <button type="button" className="btn" onClick={() => go("/orders/new")}>New order</button>
      </div>
      <Banner message={error} />
      <div className="filters">
        <div className="filter-groups">
          <div className="filter-pills">
            {FILTERS.map((item) => (
              <button key={item.id} type="button" className={status === item.id ? "pill-btn active" : "pill-btn"} onClick={() => { setStatus(item.id); setPage(1) }}>
                {item.label}
              </button>
            ))}
          </div>
          {courierPills.length ? (
            <div className="filter-pills courier-pills">
              <span className="filter-name">Steadfast</span>
              {courierPills.map((item) => {
                const id = `sf:${item}`
                return (
                  <button key={id} type="button" className={status === id ? "pill-btn active" : "pill-btn"} onClick={() => { setStatus(id); setPage(1) }}>
                    {courierStatusLabel(item)}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        <div className="filter-tools">
          <input value={q} onChange={(event) => { setQ(event.target.value); setPage(1) }} placeholder="Name, mobile, or RG number" aria-label="Search" />
          <select aria-label="Source" value={source} onChange={(event) => { setSource(event.target.value); setPage(1) }}>
            <option value="all">All sources</option>
            {sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            <option value="none">Not set</option>
          </select>
          <DateRange allowAll value={range} onChange={(next) => { setRange(next); setPage(1) }} />
        </div>
      </div>

      <article className="card list-card" aria-busy={loading}>
        <div className="table-card">
        {loading ? <p className="muted load-line">Loading…</p> : null}
        {!loading && data && data.orders.length === 0 ? <Empty title="No orders" text="Nothing matched this search." /> : null}
        {!loading && data && data.orders.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Address</th>
                <th>Source</th>
                <th>Time</th>
                <th>Status</th>
                <th>Total</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <tr key={order.id} onClick={() => go(`/orders/${order.id}`)}>
                  <td data-label="Order">
                    <strong>{order.number}</strong>
                    {order.consignmentId ? <ParcelEye orderId={order.id} /> : null}
                  </td>
                  <td data-label="Customer">
                    <CopyText value={order.customerName} label="Name" />
                    <small>
                      <CopyText value={order.mobile} label="Number" />
                      <br />
                      {order.courier}
                      {order.trackingCode ? <><br />{order.trackingCode}</> : null}
                      {order.courierStatus ? <><br />{courierStatusLabel(order.courierStatus)}</> : null}
                    </small>
                  </td>
                  <td data-label="Address"><CopyText value={order.address} label="Address" className="copy-address" /></td>
                  <td data-label="Source">{order.sourceName || "—"}</td>
                  <td data-label="Time">{when(order.orderedAt)}</td>
                  <td data-label="Status">
                    <StatusMenu order={order} onChanged={replaceOrder} />
                  </td>
                  <td data-label="Total">{taka(order.total)}</td>
                  <td data-label="Due" className={order.due > 0 ? "danger" : ""}>{taka(order.due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        </div>
        {!loading && data && data.total > 0 ? (
          <Pager
            page={page}
            total={data.total}
            pageSize={pageSize}
            pageSizes={PAGE_SIZES}
            onPage={showPage}
            onPageSize={(next) => { setPageSize(next); setPage(1) }}
          />
        ) : null}
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
          sourceId: order.sourceId,
          codPaidBy: order.codPaidBy || "free",
          codCharge: order.codCharge || 0,
          note: order.note,
        },
      })
      onChanged(body.order)
      if (body.order.courierError && !body.order.consignmentId) {
        toast.error(body.order.courierError)
        setOpen(false)
        return
      }
      const restored = !holdsStock(nextStatus) && holdsStock(order.status)
      toast.success(restored ? `Marked ${statusLabel(nextStatus)}. Stock is back.` : `Status is now ${statusLabel(nextStatus)}`)
      setOpen(false)
    } catch (reason) {
      toast.error(reason.message)
    } finally {
      setBusy(false)
    }
  }

  if (!MANUAL_STATUSES.some((item) => item.id === order.status)) return <StatusPill status={order.status} />

  return (
    <div className="status-menu" ref={box} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        ref={trigger}
        className={`pill pill-${order.status} status-trigger`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${statusLabel(order.status)}, change status`}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        {statusLabel(order.status)}
        <Caret />
      </button>
      {open && spot ? (
        <ul className="status-pop" role="listbox" style={{ top: spot.top, left: spot.left }}>
          {MANUAL_STATUSES.map((item) => (
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
