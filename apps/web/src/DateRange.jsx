import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { PRESETS, addMonths, formatDay, formatRange, matchPreset, monthGrid, monthTitle, parts, rangeFor, todayISO, weekdayLabels } from "./dates.js"

export default function DateRange({ value, onChange, allowAll = false }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [preset, setPreset] = useState("30")
  const [anchor, setAnchor] = useState(null)
  const [hover, setHover] = useState(null)
  const [view, setView] = useState(() => parts(todayISO()))
  const [spot, setSpot] = useState(null)
  const trigger = useRef(null)
  const pop = useRef(null)

  function openPanel() {
    const today = todayISO()
    const next = value || null
    setDraft(next)
    setPreset(matchPreset(next, today))
    setAnchor(null)
    setHover(null)
    const focus = next?.from || today
    setView(parts(focus))
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) return undefined
    function place() {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const mobile = window.innerWidth <= 860
      const width = mobile ? Math.min(window.innerWidth - 16, 420) : Math.min(620, window.innerWidth - 16)
      let left = mobile ? 8 : rect.right - width
      if (left < 8) left = 8
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
      const top = rect.bottom + 8
      setSpot({ top, left, width, maxHeight: Math.max(240, window.innerHeight - top - (mobile ? 88 : 12)) })
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
      if (pop.current?.contains(event.target) || trigger.current?.contains(event.target)) return
      setOpen(false)
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

  function choosePreset(id) {
    if (id === "all") {
      setDraft(null)
      setPreset("all")
      setAnchor(null)
      return
    }
    if (id === "custom") {
      setPreset("custom")
      if (!draft) {
        const today = todayISO()
        setDraft({ from: today, to: today })
        setView(parts(today))
      }
      return
    }
    const today = todayISO()
    const next = rangeFor(id, today)
    setDraft(next)
    setPreset(id)
    setAnchor(null)
    setView(parts(next.from))
  }

  function pick(day) {
    setPreset("custom")
    if (!anchor) {
      setAnchor(day)
      setDraft({ from: day, to: day })
      return
    }
    const from = day < anchor ? day : anchor
    const to = day < anchor ? anchor : day
    setDraft({ from, to })
    setAnchor(null)
    setHover(null)
  }

  const preview = anchor && hover
    ? { from: hover < anchor ? hover : anchor, to: hover < anchor ? anchor : hover }
    : draft
  const right = addMonths(isoOf(view), 1)
  const today = todayISO()

  return (
    <div className="range">
      <button type="button" className="range-trigger" ref={trigger} aria-expanded={open} onClick={() => (open ? setOpen(false) : openPanel())}>
        <CalendarIcon />
        <span>{formatRange(value)}</span>
      </button>
      {open && spot ? createPortal(
        <div className="range-pop" ref={pop} style={{ top: spot.top, left: spot.left, width: spot.width, maxHeight: spot.maxHeight }} role="dialog" aria-label="তারিখের পরিসর">
          <div className="range-body">
            <div className="range-presets">
              {allowAll ? <button type="button" className={preset === "all" ? "active" : ""} onClick={() => choosePreset("all")}>সব সময়</button> : null}
              {PRESETS.map((item) => (
                <button key={item.id} type="button" className={preset === item.id ? "active" : ""} onClick={() => choosePreset(item.id)}>{item.label}</button>
              ))}
            </div>
            <div className="range-months">
              <Month year={view.year} month={view.month} preview={preview} today={today} onPick={pick} onHover={setHover} onPrev={() => setView(addMonths(isoOf(view), -1))} onNext={() => setView(addMonths(isoOf(view), 1))} />
              <Month year={right.year} month={right.month} preview={preview} today={today} onPick={pick} onHover={setHover} onNext={() => setView(addMonths(isoOf(view), 1))} />
            </div>
          </div>
          <div className="range-foot">
            <span>{draft ? `${formatDay(draft.from)} – ${formatDay(draft.to)}` : "সব সময়"}</span>
            <div>
              <button type="button" className="btn secondary" onClick={() => setOpen(false)}>বাতিল</button>
              <button type="button" className="btn" disabled={preset !== "all" && !draft} onClick={() => { onChange(draft); setOpen(false) }}>প্রয়োগ</button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

function Month({ year, month, preview, today, onPick, onHover, onPrev, onNext }) {
  return (
    <div className="cal">
      <div className="cal-head">
        {onPrev ? <button type="button" aria-label="আগের মাস" onClick={onPrev}>‹</button> : <span />}
        <strong>{monthTitle(year, month)}</strong>
        {onNext ? <button type="button" className="next-month" aria-label="পরের মাস" onClick={onNext}>›</button> : <span />}
      </div>
      <div className="cal-grid cal-week">
        {weekdayLabels().map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="cal-grid" onMouseLeave={() => onHover(null)}>
        {monthGrid(year, month).map((day, index) => {
          if (!day) return <span key={`empty-${index}`} />
          const start = preview && day === preview.from
          const end = preview && day === preview.to
          const inside = preview && day > preview.from && day < preview.to
          const classes = ["day"]
          if (inside) classes.push("in")
          if (start) classes.push("edge")
          if (end) classes.push("edge")
          if (day === today) classes.push("today")
          return (
            <button
              key={day}
              type="button"
              className={classes.join(" ")}
              onClick={() => onPick(day)}
              onMouseEnter={() => onHover(day)}
            >
              {Number(day.slice(8))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function isoOf(view) {
  return `${view.year}-${String(view.month).padStart(2, "0")}-01`
}

function CalendarIcon() {
  return (
    <svg className="range-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 3.5v4M16 3.5v4M3.5 10h17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
