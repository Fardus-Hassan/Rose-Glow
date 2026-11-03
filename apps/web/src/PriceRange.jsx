import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { taka } from "./format.js"

const PHONE = "(max-width: 600px)"
const PRESETS = [
  { min: "", max: "499", label: "Under ৳500" },
  { min: "500", max: "999", label: "৳500 – ৳999" },
  { min: "1000", max: "1999", label: "৳1,000 – ৳1,999" },
  { min: "2000", max: "", label: "৳2,000 and up" },
]

export function priceText(value) {
  const min = value?.min ?? ""
  const max = value?.max ?? ""
  if (min && max) return `${taka(Number(min))} – ${taka(Number(max))}`
  if (min) return `${taka(Number(min))} and up`
  if (max) return `Up to ${taka(Number(max))}`
  return "Any price"
}

// value: { min, max } as digit strings, "" when that side is open.
export default function PriceRange({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [min, setMin] = useState("")
  const [max, setMax] = useState("")
  const [place, setPlace] = useState(null)
  const [phone, setPhone] = useState(false)
  const trigger = useRef(null)
  const panel = useRef(null)
  const first = useRef(null)
  const set = Boolean(value?.min || value?.max)
  const wrong = min !== "" && max !== "" && Number(min) > Number(max)

  function openPanel() {
    setMin(value?.min ?? "")
    setMax(value?.max ?? "")
    setOpen(true)
  }

  function apply(next) {
    onChange(next.min || next.max ? next : { min: "", max: "" })
    setOpen(false)
    trigger.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return undefined
    const media = window.matchMedia(PHONE)
    function measure() {
      setPhone(media.matches)
      if (media.matches || !trigger.current) return
      const box = trigger.current.getBoundingClientRect()
      const width = Math.min(300, window.innerWidth - 16)
      const below = window.innerHeight - box.bottom - 12
      const up = below < 300 && box.top > below
      setPlace({
        left: Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8)),
        width,
        top: up ? undefined : box.bottom + 6,
        bottom: up ? window.innerHeight - box.top + 6 : undefined,
      })
    }
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    if (!phone) first.current?.focus({ preventScroll: true })
    function away(event) {
      if (trigger.current?.contains(event.target) || panel.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [open, phone])

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
  }

  const digits = (text) => text.replace(/[^\d]/g, "").slice(0, 9)
  const body = (
    <form className="price-body" onSubmit={(event) => { event.preventDefault(); if (!wrong) apply({ min, max }) }}>
      {phone ? (
        <div className="select-sheet-head">
          <strong>Price</strong>
          <button type="button" className="select-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
        </div>
      ) : null}
      <div className="price-inputs">
        <label>
          <span>Lowest</span>
          <input ref={first} inputMode="numeric" placeholder="৳0" value={min} onChange={(event) => setMin(digits(event.target.value))} />
        </label>
        <i aria-hidden="true">–</i>
        <label>
          <span>Highest</span>
          <input inputMode="numeric" placeholder="Any" value={max} onChange={(event) => setMax(digits(event.target.value))} />
        </label>
      </div>
      {wrong ? <p className="price-wrong">Lowest is higher than highest</p> : null}
      <div className="price-presets">
        {PRESETS.map((item) => {
          const on = (value?.min ?? "") === item.min && (value?.max ?? "") === item.max
          return (
            <button key={item.label} type="button" className={on ? "pill-btn active" : "pill-btn"} onClick={() => apply({ min: item.min, max: item.max })}>
              {item.label}
            </button>
          )
        })}
      </div>
      <div className="select-foot">
        <span>Order total</span>
        {set || min || max ? <button type="button" className="text-btn" onClick={() => apply({ min: "", max: "" })}>Clear</button> : null}
        <button type="submit" className="btn select-done" disabled={wrong}>Apply</button>
      </div>
    </form>
  )

  return (
    <div className="select price-range">
      <button
        ref={trigger}
        type="button"
        className={`select-trigger${set ? "" : " empty"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Price: ${priceText(value)}`}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <span className="select-text">{priceText(value)}</span>
        <svg className="select-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? createPortal(
        phone ? (
          <div className="select-back" onPointerDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
            <div ref={panel} className="select-panel sheet" role="dialog" aria-label="Price" onKeyDown={onKeyDown}>{body}</div>
          </div>
        ) : (
          <div ref={panel} className="select-panel" role="dialog" aria-label="Price" style={place || { visibility: "hidden" }} onKeyDown={onKeyDown}>{body}</div>
        ),
        document.body,
      ) : null}
    </div>
  )
}
