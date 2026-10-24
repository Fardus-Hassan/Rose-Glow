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
