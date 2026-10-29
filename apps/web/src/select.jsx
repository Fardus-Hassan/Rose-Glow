import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

const SEARCH_FROM = 7
const PHONE = "(max-width: 600px)"

// options: [{ value, label, hint?, group?, disabled? }]. Values come back as strings,
// a single string, or an array of strings when `multiple` is set.
export default function Select({
  value,
  onChange,
  options,
  multiple = false,
  placeholder = "Choose",
  allLabel = "",
  search,
  disabled = false,
  required = false,
  label = "",
  className = "",
  onDone,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(-1)
  const [place, setPlace] = useState(null)
  const [phone, setPhone] = useState(false)
  const trigger = useRef(null)
  const panel = useRef(null)
  const searchBox = useRef(null)
  const list = useRef(null)
  const listId = useId()

  const picked = multiple
    ? (Array.isArray(value) ? value : []).map(String)
    : value === "" || value === null || value === undefined ? [] : [String(value)]
  const pickedSet = new Set(picked)
  const latest = useRef(picked)
  latest.current = picked
  const searchable = search ?? options.length >= SEARCH_FROM
  const term = query.trim().toLowerCase()
  const shown = term ? options.filter((option) => `${option.label} ${option.hint || ""} ${option.group || ""}`.toLowerCase().includes(term)) : options
  const chosen = options.filter((option) => pickedSet.has(String(option.value)))

  let text = ""
  if (!picked.length) text = multiple ? allLabel || placeholder : placeholder
  else if (!multiple) text = chosen[0]?.label ?? picked[0]
  else if (chosen.length === 1) text = chosen[0].label
  else text = `${chosen[0]?.label ?? picked[0]} +${picked.length - 1}`
  const empty = !picked.length && !(multiple && allLabel)

  function openPanel() {
    if (disabled) return
    const first = options.findIndex((option) => pickedSet.has(String(option.value)))
    setQuery("")
    setActive(first >= 0 ? first : nextEnabled(options, -1, 1))
    setOpen(true)
  }

  function close(refocus) {
    setOpen(false)
    if (refocus) trigger.current?.focus()
    if (multiple && onDone && latest.current.length) {
      const done = latest.current
      latest.current = []
      onDone(done)
    }
  }

  function choose(option) {
    if (!option || option.disabled) return
    const id = String(option.value)
    if (multiple) {
      const next = pickedSet.has(id) ? picked.filter((item) => item !== id) : [...picked, id]
      const order = options.map((item) => String(item.value))
      onChange(next.sort((a, b) => order.indexOf(a) - order.indexOf(b)))
      return
    }
    onChange(id)
    close(true)
  }

  useLayoutEffect(() => {
    if (!open) return undefined
    const media = window.matchMedia(PHONE)
    function measure() {
      setPhone(media.matches)
      if (media.matches || !trigger.current) return
      const box = trigger.current.getBoundingClientRect()
      const below = window.innerHeight - box.bottom - 12
      const above = box.top - 12
      const up = below < 260 && above > below
      const width = Math.min(Math.max(box.width, 240), window.innerWidth - 16)
      setPlace({
        left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
        width,
        top: up ? undefined : box.bottom + 6,
        bottom: up ? window.innerHeight - box.top + 6 : undefined,
        maxHeight: Math.max(180, Math.min(380, up ? above : below)),
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
    const target = searchable && !phone ? searchBox.current : list.current
    target?.focus({ preventScroll: true })
    function away(event) {
      if (trigger.current?.contains(event.target) || panel.current?.contains(event.target)) return
      close(false)
    }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [open, phone])

  useEffect(() => {
    if (!open || !phone) return undefined
    const before = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = before }
  }, [open, phone])

  useEffect(() => {
    if (!open || active < 0) return
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active, open])

  useEffect(() => {
    if (!open) return
    setActive((index) => (index >= 0 && index < shown.length && !shown[index].disabled ? index : nextEnabled(shown, -1, 1)))
  }, [term])

  function onKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => nextEnabled(shown, index, 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => nextEnabled(shown, index, -1))
    } else if (event.key === "Home" && event.target !== searchBox.current) {
      event.preventDefault()
      setActive(nextEnabled(shown, -1, 1))
    } else if (event.key === "End" && event.target !== searchBox.current) {
      event.preventDefault()
      setActive(nextEnabled(shown, shown.length, -1))
    } else if (event.key === "Enter") {
      event.preventDefault()
      choose(shown[active])
    } else if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === "Tab") {
      close(false)
    }
  }

  function onTriggerKey(event) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault()
      openPanel()
    }
  }

  let lastGroup = ""
  const body = (
    <>
      {phone ? (
        <div className="select-sheet-head">
          <strong>{label || placeholder}</strong>
          <button type="button" className="select-x" aria-label="Close" onClick={() => close(true)}>×</button>
        </div>
      ) : null}
      {searchable ? (
        <div className="select-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={searchBox}
            type="search"
            value={query}
            placeholder="Search"
            aria-label={`Search ${label || "options"}`}
            aria-controls={listId}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}
      <ul
        ref={list}
        id={listId}
        className="select-list"
        role="listbox"
        tabIndex={-1}
        aria-label={label || placeholder}
        aria-multiselectable={multiple || undefined}
        aria-activedescendant={active >= 0 && shown[active] ? `${listId}-${active}` : undefined}
      >
        {shown.length === 0 ? <li className="select-empty">No match for “{query.trim()}”</li> : null}
        {shown.map((option, index) => {
          const head = option.group && option.group !== lastGroup ? option.group : ""
          if (option.group) lastGroup = option.group
          const on = pickedSet.has(String(option.value))
          return (
            <Fragment key={String(option.value)}>
              {head ? <li className="select-group" role="presentation">{head}</li> : null}
              <li
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={on}
                aria-disabled={option.disabled || undefined}
                className={["select-option", on ? "on" : "", index === active ? "active" : "", option.disabled ? "off" : ""].filter(Boolean).join(" ")}
                onPointerMove={() => { if (!option.disabled && active !== index) setActive(index) }}
                onClick={() => choose(option)}
              >
                {multiple ? <i className="select-box" aria-hidden="true">{on ? "✓" : ""}</i> : null}
                <span className="select-label">{option.label}</span>
                {option.hint ? <span className="select-hint">{option.hint}</span> : null}
                {!multiple && on ? <i className="select-tick" aria-hidden="true">✓</i> : null}
              </li>
            </Fragment>
          )
        })}
      </ul>
      {multiple ? (
        <div className="select-foot">
          <span>{picked.length ? `${picked.length} selected` : allLabel || "None selected"}</span>
          {picked.length ? <button type="button" className="text-btn" onClick={() => onChange([])}>Clear</button> : null}
          <button type="button" className="btn select-done" onClick={() => close(true)}>Done</button>
        </div>
      ) : null}
    </>
  )

  return (
    <div className={`select ${className}`.trim()}>
      <button
        ref={trigger}
        type="button"
        className={`select-trigger${empty ? " empty" : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label ? `${label}: ${text}` : undefined}
        onClick={() => (open ? close(false) : openPanel())}
        onKeyDown={onTriggerKey}
      >
        <span className="select-text">{text}</span>
        <svg className="select-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {required ? (
        <input className="select-proxy" tabIndex={-1} aria-hidden="true" required value={picked.length ? "1" : ""} onChange={() => {}} />
      ) : null}
      {open ? createPortal(
        phone ? (
          <div className="select-back" onPointerDown={(event) => { if (event.target === event.currentTarget) close(false) }}>
            <div ref={panel} className="select-panel sheet" role="dialog" aria-label={label || placeholder} onKeyDown={onKeyDown} onClick={(event) => event.stopPropagation()}>
              {body}
            </div>
          </div>
        ) : (
          <div ref={panel} className="select-panel" style={place || { visibility: "hidden" }} onKeyDown={onKeyDown} onClick={(event) => event.stopPropagation()}>
            {body}
          </div>
        ),
        document.body,
      ) : null}
    </div>
  )
}

export function productOptions(products, hintFor) {
  return [...products]
    .sort((a, b) => Number(a.isCombo) - Number(b.isCombo))
    .map((product) => ({ value: String(product.id), label: product.name, hint: hintFor(product), group: product.isCombo ? "Combos" : "Products" }))
}

function nextEnabled(list, from, step) {
  for (let index = from + step; index >= 0 && index < list.length; index += step) {
    if (!list[index].disabled) return index
  }
  return from >= 0 && from < list.length ? from : -1
}
