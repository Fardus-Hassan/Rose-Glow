import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { statusLabel } from "@rose/shared"

const confirmListeners = new Set()

// Opens the app's own yes/no box (ConfirmHost must be mounted). Resolves true on yes.
export function askConfirm({ title, message = "", yes = "Yes", no = "No", danger = false }) {
  return new Promise((resolve) => {
    confirmListeners.forEach((show) => show({ title, message, yes, no, danger, resolve }))
  })
}

export function ConfirmHost() {
  const [ask, setAsk] = useState(null)

  useEffect(() => {
    confirmListeners.add(setAsk)
    return () => confirmListeners.delete(setAsk)
  }, [])

  useEffect(() => {
    if (!ask) return undefined
    function onKey(event) {
      if (event.key !== "Escape") return
      event.stopPropagation()
      finish(false)
    }
    // Capture phase, so Escape closes only this box and not a modal underneath.
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  })

  function finish(answer) {
    ask?.resolve(answer)
    setAsk(null)
  }

  if (!ask) return null
  return (
    <div className="modal-back confirm-back" role="presentation" onClick={() => finish(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="confirm-title">{ask.title}</h2>
        {ask.message ? <p className="muted">{ask.message}</p> : null}
        <div className="actions">
          <button type="button" className="btn secondary" onClick={() => finish(false)}>{ask.no}</button>
          <button type="button" className={ask.danger ? "btn danger" : "btn"} onClick={() => finish(true)} autoFocus>{ask.yes}</button>
        </div>
      </div>
    </div>
  )
}

// The question to ask before a hand status change that touches the courier, or null if none is needed.
export function courierStatusQuestion(order, next) {
  const current = order?.status
  if (!order || next === current) return null
  if (next === "courier") {
    const sends = String(order.courier || "").trim().toLowerCase() === "steadfast" && !order.consignmentId
    return {
      title: "Move to In courier?",
      message: sends ? "This sends the parcel to Steadfast right now." : "The order will be marked as handed to the courier.",
      yes: sends ? "Yes, send it" : "Yes, move it",
    }
  }
  if (current === "courier" && (next === "new" || next === "confirmed")) {
    return {
      title: `Move back to ${statusLabel(next)}?`,
      message: order.consignmentId
        ? "The parcel stays booked in Steadfast. This only changes it here. If you removed it in Steadfast, use \"Removed in Steadfast\" instead."
        : "The order leaves In courier.",
      yes: "Yes, move it",
    }
  }
  return null
}

export function Field({ label, children, className = "" }) {
  return (
    <label className={`field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Banner({ message, tone = "bad" }) {
  if (!message) return null
  return <p className={`banner banner-${tone}`}>{message}</p>
}

export function CopyText({ value, label, className = "" }) {
  async function copy(event) {
    event.preventDefault()
    event.stopPropagation()
    const text = String(value ?? "").trim()
    if (!text) return
    try {
      await writeClipboard(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Could not copy")
    }
  }
  return (
    <button type="button" className={`copy-text ${className}`.trim()} onClick={copy} title="Click to copy">
      {value}
    </button>
  )
}

async function writeClipboard(text) {
  if (document.hasFocus() && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch { /* the click can still use the older copy path */ }
  }
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.top = "0"
  area.style.left = "0"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.focus()
  area.select()
  const ok = document.execCommand("copy")
  area.remove()
  if (!ok) throw new Error("copy failed")
}

export function contactLinks(mobile) {
  const digits = String(mobile ?? "").replace(/\D/g, "")
  const intl = digits.startsWith("880") ? digits : digits.startsWith("0") ? `880${digits.slice(1)}` : digits
  if (intl.length < 8) return null
  const plus = `+${intl}`
  return {
    plus,
    call: `tel:${plus}`,
    whatsapp: `https://wa.me/${intl}`,
    telegram: `https://t.me/${plus}`,
    imo: `imo://chat?phone=${encodeURIComponent(plus)}`,
  }
}

export function ContactActions({ mobile }) {
  const links = contactLinks(mobile)
  if (!links) return null
  async function openImo(event) {
    event.stopPropagation()
    try {
      await writeClipboard(links.plus)
      toast.success("Number copied. Search it in IMO.")
    } catch {
      toast.error("Could not copy the number")
    }
  }
  return (
    <span className="reach" onClick={(event) => event.stopPropagation()}>
      <a className="reach-btn reach-wa" href={links.whatsapp} target="_blank" rel="noreferrer" aria-label="WhatsApp" title="WhatsApp">
        <WhatsAppIcon />
      </a>
      <a className="reach-btn reach-imo" href={links.imo} onClick={openImo} aria-label="IMO" title="IMO">
        <ImoIcon />
      </a>
      <a className="reach-btn reach-tg" href={links.telegram} target="_blank" rel="noreferrer" aria-label="Telegram" title="Telegram">
        <TelegramIcon />
      </a>
      <a className="reach-btn reach-call" href={links.call} aria-label="Call" title="Call">
        <CallIcon />
      </a>
    </span>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12.04 2C6.58 2 2.15 6.4 2.15 11.83c0 1.74.46 3.44 1.32 4.94L2 22l5.39-1.41a10.1 10.1 0 0 0 4.65 1.17h.01c5.46 0 9.89-4.4 9.89-9.83C21.94 6.4 17.5 2 12.04 2Zm5.8 14.15c-.24.68-1.4 1.25-1.93 1.33-.49.08-1.1.11-1.78-.11-.41-.13-.94-.31-1.62-.6-2.85-1.23-4.7-4.1-4.85-4.29-.14-.19-1.15-1.53-1.15-2.92 0-1.39.73-2.07.99-2.36.24-.27.64-.41 1.02-.41.12 0 .23 0 .33.01.3.01.44.03.64.5.24.58.82 2 .89 2.15.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.16-.29.36-.42.48-.14.14-.28.29-.12.56.16.27.71 1.17 1.53 1.9 1.04.93 1.92 1.22 2.2 1.36.27.14.43.12.59-.07.16-.19.69-.8.87-1.08.18-.27.37-.23.62-.14.26.1 1.62.76 1.9.9.27.14.46.21.53.32.06.12.06.68-.18 1.36Z" />
    </svg>
  )
}

function ImoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7.2 4.2h9.6A3.2 3.2 0 0 1 20 7.4v6.2a3.2 3.2 0 0 1-3.2 3.2h-4.1L8.2 19.6c-.7.5-1.7 0-1.7-.9v-2a3.2 3.2 0 0 1-2.5-3.1V7.4a3.2 3.2 0 0 1 3.2-3.2Z" />
    </svg>
  )
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M21.2 4.4 2.9 11.4c-1.2.5-1.2 1.1-.2 1.4l4.7 1.5 1.8 5.7c.2.7.1.9.9.9.5 0 .8-.2 1.1-.5l2.5-2.4 4.9 3.6c.9.5 1.5.2 1.7-.8l3-14.1c.3-1.3-.5-1.9-1.4-1.5Zm-3.2 3.3-8.6 7.8-.3 3.4-1.4-4.4 10.3-6.8Z" />
    </svg>
  )
}

function CallIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7.1 3.2c.4-.4 1.1-.4 1.5 0l2 2c.4.4.4 1.1 0 1.5l-1.4 1.4c-.2.2-.3.5-.2.8 1.2 3.4 3.9 6.1 7.3 7.3.3.1.6 0 .8-.2l1.4-1.4c.4-.4 1.1-.4 1.5 0l2 2c.4.4.4 1.1 0 1.5l-1.2 1.2c-.5.5-1.2.8-2 .7-6.2-.7-11.1-5.6-11.8-11.8-.1-.8.2-1.5.7-2l1.2-1.2Z" />
    </svg>
  )
}

export function StatusPill({ status }) {
  return <span className={`pill pill-${status}`}>{statusLabel(status)}</span>
}

export function Empty({ title, text }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  )
}

export const LIST_PAGE = 20

export function Pager({ page, total, pageSize = LIST_PAGE, onPage, pageSizes, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= 0) return null
  if (!pageSizes && total <= pageSize) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  return (
    <nav className={pageSizes ? "pager pager-bar" : "pager"} aria-label="Pages">
      {pageSizes ? (
        <div className="pager-meta">
          <span>Page {page} / {pages}</span>
          <label>
            Rows
            <select aria-label="Rows per page" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
              {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
      ) : <p className="muted small">{start}–{end} / {total}</p>}
      <div className="pager-controls">
        {pageSizes ? <button type="button" aria-label="First page" onClick={() => onPage(1)} disabled={page <= 1}>«</button> : null}
        <button type="button" aria-label="Previous page" onClick={() => onPage(page - 1)} disabled={page <= 1}>{pageSizes ? "‹" : "Previous"}</button>
        {pageList(page, pages).map((item, index) => (
          item === "…"
            ? <span key={`gap-${index}`} className="pager-gap">…</span>
            : <button type="button" key={item} className={item === page ? "active" : ""} aria-current={item === page ? "page" : undefined} onClick={() => onPage(item)}>{item}</button>
        ))}
        <button type="button" aria-label="Next page" onClick={() => onPage(page + 1)} disabled={page >= pages}>{pageSizes ? "›" : "Next"}</button>
        {pageSizes ? <button type="button" aria-label="Last page" onClick={() => onPage(pages)} disabled={page >= pages}>»</button> : null}
      </div>
    </nav>
  )
}

function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1)
  const picks = [1, pages, page - 1, page, page + 1].filter((item, index, list) => item >= 1 && item <= pages && list.indexOf(item) === index).sort((a, b) => a - b)
  const items = []
  picks.forEach((item, index) => {
    if (index > 0 && item - picks[index - 1] > 1) items.push("…")
    items.push(item)
  })
  return items
}
