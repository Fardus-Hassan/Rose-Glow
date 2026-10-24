import toast from "react-hot-toast"
import { statusLabel } from "@rose/shared"

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
      <a className="reach-btn" href={links.whatsapp} target="_blank" rel="noreferrer" aria-label="WhatsApp" title="WhatsApp">
        <WhatsAppIcon />
      </a>
      <a className="reach-btn reach-imo" href={links.imo} onClick={openImo} aria-label="IMO" title="IMO">imo</a>
      <a className="reach-btn" href={links.telegram} target="_blank" rel="noreferrer" aria-label="Telegram" title="Telegram">
        <TelegramIcon />
      </a>
      <a className="reach-btn" href={links.call} aria-label="Call" title="Call">
        <CallIcon />
      </a>
    </span>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 3.2A8.7 8.7 0 0 0 4.6 16.3L3.4 20.6l4.4-1.2A8.8 8.8 0 1 0 12 3.2Zm4.9 12.3c-.2.6-1.2 1.1-1.7 1.1-.4.1-1 .1-1.6-.1-.4-.1-.8-.3-1.4-.5-2.4-1-4-3.5-4.1-3.7-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.2.5-.3.8-.3h.3c.2 0 .4 0 .5.4.2.5.7 1.7.7 1.8.1.1.1.3 0 .4-.1.2-.1.3-.2.4l-.4.4c-.1.1-.2.2-.1.5.1.2.6 1 1.3 1.6.9.8 1.6 1 1.9 1.2.2.1.4.1.5-.1.1-.2.6-.7.7-.9.2-.2.3-.2.5-.1.2.1 1.4.7 1.6.8.2.1.4.2.4.3.1.2.1.6-.1.9Z" />
    </svg>
  )
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M20.7 4.6 3.4 11.2c-1.2.5-1.2 1.1-.2 1.4l4.4 1.4 10.2-6.4c.5-.3.9-.1.6.2l-8.3 7.5-.3 4.5c.4 0 .6-.2.9-.4l2.1-2 4.4 3.2c.8.5 1.4.2 1.6-.7l2.9-13.7c.3-1.2-.4-1.7-1.3-1.4Z" />
    </svg>
  )
}

function CallIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M8 3.8c.3-.4.9-.5 1.4-.3l1.8 1c.4.2.6.7.5 1.2l-.4 1.8c-.1.4.1.8.4 1.1l1.3 1.1c.8.6 1.7 1.1 2.7 1.4l1.7-.6c.4-.1.9 0 1.2.3l1.2 1.6c.3.4.2.9-.1 1.3l-1.2 1.1c-.4.4-.9.5-1.4.4-5.2-.9-9.3-5-10.2-10.2-.1-.5.1-1 .4-1.4Z" />
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
