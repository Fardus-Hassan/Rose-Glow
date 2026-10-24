import { useEffect, useRef, useState } from "react"
import { api } from "./api.js"
import { when } from "./format.js"
import { useRoute } from "./route.jsx"

export default function Notifications() {
  const { go } = useRoute()
  const [open, setOpen] = useState(false)
  const [feed, setFeed] = useState({ unread: 0, items: [] })
  const box = useRef(null)

  useEffect(() => {
    let live = true
    async function load() {
      try {
        const body = await api("/api/courier/notifications")
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
      const body = await api("/api/courier/notifications/read", { method: "POST", body: { ids: [item.id] } }).catch(() => null)
      if (body) setFeed(body)
    }
    if (item.orderId) go(`/orders/${item.orderId}`)
  }

  async function readAll() {
    const body = await api("/api/courier/notifications/read", { method: "POST", body: {} }).catch(() => null)
    if (body) setFeed(body)
  }

  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className="bell-btn"
        aria-label={feed.unread ? `নোটিফিকেশন, ${feed.unread}টা নতুন` : "নোটিফিকেশন"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon />
        {feed.unread > 0 ? <span className="bell-count">{feed.unread > 9 ? "9+" : feed.unread}</span> : null}
      </button>
      {open ? (
        <div className="bell-panel card" role="dialog" aria-label="পার্সেল নোটিফিকেশন">
          <div className="card-head">
            <h2>পার্সেল</h2>
            {feed.unread > 0 ? <button type="button" className="text-btn" onClick={readAll}>সব পড়া হয়েছে</button> : null}
          </div>
          {feed.items.length === 0 ? <p className="muted">এখনো কোনো আপডেট নেই।</p> : null}
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
