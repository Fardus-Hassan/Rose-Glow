import { useEffect, useRef, useState } from "react"
import { api } from "./api.js"
import { taka } from "./format.js"
import { useRoute } from "./route.jsx"
import { StatusPill } from "./ui.jsx"

const SHOWN = 6

function SearchIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export default function TopSearch() {
  const { go } = useRoute()
  const [text, setText] = useState("")
  const [found, setFound] = useState(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [shown, setShown] = useState(false)
  const box = useRef(null)
  const input = useRef(null)
  const term = text.trim()

  useEffect(() => {
    if (term.length < 2) {
      setFound(null)
      return undefined
    }
    let live = true
    const timer = setTimeout(() => {
      api(`/api/orders?${new URLSearchParams({ q: term, limit: String(SHOWN) })}`)
        .then((body) => { if (live) { setFound({ term, orders: body.orders, total: body.total }); setActive(-1) } })
        .catch(() => { if (live) setFound({ term, orders: [], total: 0 }) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [term])

  useEffect(() => {
    function onKey(event) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable
      if (event.key === "/" && !typing) {
        event.preventDefault()
        setShown(true)
        input.current?.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!open && !shown) return undefined
    function away(event) {
      if (!box.current?.contains(event.target)) {
        setOpen(false)
        setShown(false)
      }
    }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [open, shown])

  useEffect(() => {
    if (shown) input.current?.focus()
  }, [shown])

  function close() {
    setOpen(false)
    setShown(false)
    setText("")
    input.current?.blur()
  }

  function openOrder(order) {
    close()
    go(`/orders/${order.id}`)
  }

  function seeAll() {
    if (!term) return
    close()
    go(`/orders?${new URLSearchParams({ q: term })}`)
  }

  const orders = found && found.term === term ? found.orders : []
  const waiting = term.length >= 2 && (!found || found.term !== term)

  function onKeyDown(event) {
    if (event.key === "Escape") {
      close()
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActive((index) => Math.min(index + 1, orders.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, -1))
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (active >= 0 && orders[active]) openOrder(orders[active])
      else if (orders.length === 1) openOrder(orders[0])
      else seeAll()
    }
  }

  return (
    <div className={`top-search${shown ? " shown" : ""}`} ref={box}>
      <button type="button" className="bell-btn search-toggle" aria-label="Search orders" onClick={() => setShown(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <label className="search-box top-search-box">
        <SearchIcon />
        <input
          ref={input}
          type="search"
          value={text}
          placeholder="Search orders: name, mobile, or RG number"
          aria-label="Search orders"
          onChange={(event) => { setText(event.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {text ? (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={() => { setText(""); input.current?.focus() }}>×</button>
        ) : null}
      </label>
      {open && term.length >= 2 ? (
        <div className="card top-search-panel">
          {waiting && !orders.length ? <p className="muted small">Searching…</p> : null}
          {!waiting && !orders.length ? <p className="muted small">No order matches “{term}”.</p> : null}
          {orders.length ? (
            <ul className="top-search-list">
              {orders.map((order, index) => (
                <li key={order.id}>
                  <button
                    type="button"
                    className={index === active ? "active" : ""}
                    onPointerEnter={() => setActive(index)}
                    onClick={() => openOrder(order)}
                  >
                    <strong>{order.number}</strong>
                    <span className="top-search-who">
                      <span>{order.customerName}</span>
                      <small>{order.mobile}</small>
                    </span>
                    <StatusPill status={order.status} />
                    <b>{taka(order.total)}</b>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {found && found.term === term && found.total > 0 ? (
            <button type="button" className="text-btn top-search-all" onClick={seeAll}>
              {found.total > orders.length ? `See all ${found.total} orders` : "Open in All orders"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
