import { statusLabel } from "@rose/shared"

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Banner({ message, tone = "bad" }) {
  if (!message) return null
  return <p className={`banner banner-${tone}`}>{message}</p>
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

export function Pager({ page, total, pageSize = LIST_PAGE, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  return (
    <nav className="pager" aria-label="পেজ">
      <p className="muted small">{start}–{end} / {total}</p>
      <div className="pager-controls">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1}>আগে</button>
        {pageList(page, pages).map((item, index) => (
          item === "…"
            ? <span key={`gap-${index}`} className="pager-gap">…</span>
            : <button type="button" key={item} className={item === page ? "active" : ""} aria-current={item === page ? "page" : undefined} onClick={() => onPage(item)}>{item}</button>
        ))}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages}>পরে</button>
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
