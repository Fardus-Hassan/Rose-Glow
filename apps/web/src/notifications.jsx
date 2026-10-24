import { useEffect, useRef, useState } from "react"
import { api } from "./api.js"
import { when } from "./format.js"
import { useRoute } from "./route.jsx"

const FEED_STEP = 20
const FEED_MAX = 1000

export default function Notifications() {
  const { go } = useRoute()
  const [open, setOpen] = useState(false)
  const [feed, setFeed] = useState({ unread: 0, total: 0, items: [] })
  const [limit, setLimit] = useState(FEED_STEP)
  const [loadingMore, setLoadingMore] = useState(false)
  const box = useRef(null)
  const limitRef = useRef(FEED_STEP)

  useEffect(() => {
    let live = true
    async function load() {
      try {
        const body = await api(`/api/courier/notifications?limit=${limitRef.current}`)
        if (live) setFeed(body)
      } catch {
        /* bell stays quiet if the server is busy */
      }
    }
    load()
    const timer = setInterval(load, 25000)
    const onFocus = () => load()
    window.addEventListener("focus", onFocus)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    }
  }, [])

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

  async function openItem(item) {
    setOpen(false)
    if (item.unread) {
      const body = await api("/api/courier/notifications/read", { method: "POST", body: { ids: [item.id], limit } }).catch(() => null)
      if (body) setFeed(body)
    }
    if (item.orderId) go(`/orders/${item.orderId}`)
  }

  async function readAll() {
    const body = await api("/api/courier/notifications/read", { method: "POST", body: { limit } }).catch(() => null)
    if (body) setFeed(body)
  }

  async function showOlder() {
    const next = limit + FEED_STEP
    setLoadingMore(true)
    try {
      const body = await api(`/api/courier/notifications?limit=${next}`)
      limitRef.current = next
      setLimit(next)
      setFeed(body)
    } catch {
      /* the button stays so the owner can try again */
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className="bell-btn"
        aria-label={feed.unread ? `Notifications, ${feed.unread} new` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon />
        {feed.unread > 0 ? <span className="bell-count">{feed.unread > 9 ? "9+" : feed.unread}</span> : null}
      </button>
      {open ? (
        <div className="bell-panel card" role="dialog" aria-label="Parcel notifications">
          <div className="card-head">
            <h2>Parcels</h2>
            {feed.unread > 0 ? <button type="button" className="text-btn" onClick={readAll}>Mark all read</button> : null}
          </div>
          {feed.items.length === 0 ? <p className="muted">No updates yet.</p> : null}
          <ul className="bell-list">
            {feed.items.map((item) => (
              <li key={item.id}>
                <button type="button" className={item.unread ? "unread" : ""} onClick={() => openItem(item)}>
                  <strong>{item.message}</strong>
                  <small>{when(item.at)}</small>
                </button>
              </li>
            ))}
          </ul>
          {feed.total > feed.items.length && limit < FEED_MAX ? (
            <div className="bell-more">
              <small className="muted">{feed.items.length} of {feed.total}</small>
              <button type="button" className="btn secondary" disabled={loadingMore} onClick={showOlder}>
                {loadingMore ? "Loading…" : "Show older"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.2 1.6H4.8L6 16.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
