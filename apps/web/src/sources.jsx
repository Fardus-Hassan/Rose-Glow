import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { api } from "./api.js"
import { Banner } from "./ui.jsx"

export function SourceField({ value, onChange, sources, onSources, required = false }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <label className="field span-2">
        <span className="label-line">
          সোর্স
          <button type="button" className="icon-add" aria-label="সোর্স যোগ বা বদলান" onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(true)}>+</button>
        </span>
        <select value={value} required={required} onChange={(event) => onChange(event.target.value)}>
          <option value="">বেছে নিন</option>
          {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select>
      </label>
      {open ? (
        <SourceModal
          sources={sources}
          onClose={() => setOpen(false)}
          onSources={onSources}
          onRemoved={(id) => {
            if (String(value) === String(id)) {
              const next = sources.find((source) => source.id !== id)
              onChange(next ? String(next.id) : "")
            }
          }}
        />
      ) : null}
    </>
  )
}

function SourceModal({ sources, onSources, onRemoved, onClose }) {
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  async function add() {
    const next = name.trim()
    if (next.length < 2) {
      setError("সোর্সের নাম দিন")
      return
    }
    setBusy(true)
    setError("")
    try {
      const body = await api("/api/sources", { method: "POST", body: { name: next } })
      onSources([...sources, body.source])
      setName("")
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal source-modal" role="dialog" aria-modal="true" aria-labelledby="source-title" onClick={(event) => event.stopPropagation()}>
        <div className="card-head">
          <h2 id="source-title">সোর্স</h2>
          <button type="button" className="text-btn" onClick={onClose}>বন্ধ</button>
        </div>
        <Banner message={error} />
        <div className="source-add">
          <input value={name} placeholder="নতুন সোর্স" aria-label="নতুন সোর্স" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add() } }} />
          <button type="button" className="btn" disabled={busy} onClick={add}>যোগ</button>
        </div>
        <ul className="source-list">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onError={setError}
              onSaved={(next) => onSources(sources.map((item) => item.id === next.id ? next : item))}
              onDeleted={(id) => {
                onSources(sources.filter((item) => item.id !== id))
                onRemoved(id)
              }}
            />
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  )
}

function SourceRow({ source, onSaved, onDeleted, onError }) {
  const [name, setName] = useState(source.name)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setName(source.name) }, [source.name])

  async function commit() {
    const next = name.trim()
    if (next === source.name) return
    if (next.length < 2) {
      setName(source.name)
      return
    }
    setBusy(true)
    onError("")
    try {
      const body = await api(`/api/sources/${source.id}`, { method: "PATCH", body: { name: next } })
      onSaved(body.source)
    } catch (reason) {
      setName(source.name)
      onError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    onError("")
    try {
      await api(`/api/sources/${source.id}`, { method: "DELETE" })
      onDeleted(source.id)
    } catch (reason) {
      onError(reason.message)
      setBusy(false)
    }
  }

  return (
    <li>
      <input
        value={name}
        aria-label={`${source.name} বদলান`}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur() } }}
      />
      <button type="button" className="text-btn danger" disabled={busy} onClick={remove} aria-label={`${source.name} মুছুন`}>মুছুন</button>
    </li>
  )
}
