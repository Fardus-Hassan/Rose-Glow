import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { api } from "./api.js"
import Select from "./select.jsx"
import { Banner, askConfirm } from "./ui.jsx"

const SOURCE_KIND = {
  title: "Sources",
  noun: "source",
  path: "/api/sources",
  key: "source",
  deleteMessage: "It leaves the source list. A source with orders or ad costs cannot be deleted.",
}

const TAG_KIND = {
  title: "Tags",
  noun: "tag",
  path: "/api/tags",
  key: "tag",
  deleteMessage: "It leaves the tag list and comes off every order that has it.",
}

function AddButton({ noun, onClick }) {
  return (
    <button type="button" className="icon-add" aria-label={`Add or edit ${noun}s`} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>+</button>
  )
}

export function SourceField({ value, onChange, sources, onSources, required = false }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <label className="field span-2">
        <span className="label-line">
          Source
          <AddButton noun="source" onClick={() => setOpen(true)} />
        </span>
        <Select
          label="Source"
          value={value === null || value === undefined ? "" : String(value)}
          required={required}
          onChange={onChange}
          options={sources.map((source) => ({ value: String(source.id), label: source.name }))}
        />
      </label>
      {open ? (
        <NameListModal
          kind={SOURCE_KIND}
          items={sources}
          onClose={() => setOpen(false)}
          onItems={onSources}
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

export function TagField({ value, onChange, tags, onTags, className = "span-2" }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <label className={`field ${className}`}>
        <span className="label-line">
          Tags
          <AddButton noun="tag" onClick={() => setOpen(true)} />
        </span>
        <Select
          multiple
          label="Tags"
          placeholder={tags.length ? "No tags" : "Add a tag with +"}
          value={value}
          onChange={onChange}
          options={tags.map((tag) => ({ value: String(tag.id), label: tag.name }))}
        />
      </label>
      {open ? (
        <NameListModal
          kind={TAG_KIND}
          items={tags}
          onClose={() => setOpen(false)}
          onItems={onTags}
          onRemoved={(id) => onChange(value.filter((item) => item !== String(id)))}
        />
      ) : null}
    </>
  )
}

export function TagList({ tags }) {
  if (!tags?.length) return null
  return (
    <span className="tag-list">
      {tags.map((tag) => <span key={tag.id} className="tag-pill">{tag.name}</span>)}
    </span>
  )
}

function NameListModal({ kind, items, onItems, onRemoved, onClose }) {
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
      setError(`Enter a ${kind.noun} name`)
      return
    }
    setBusy(true)
    setError("")
    try {
      const body = await api(kind.path, { method: "POST", body: { name: next } })
      onItems([...items, body[kind.key]])
      setName("")
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal source-modal" role="dialog" aria-modal="true" aria-labelledby="name-list-title" onClick={(event) => event.stopPropagation()}>
        <div className="card-head">
          <h2 id="name-list-title">{kind.title}</h2>
          <button type="button" className="text-btn" onClick={onClose}>Close</button>
        </div>
        <Banner message={error} />
        <div className="source-add">
          <input value={name} placeholder={`New ${kind.noun}`} aria-label={`New ${kind.noun}`} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add() } }} />
          <button type="button" className="btn" disabled={busy} onClick={add}>Add</button>
        </div>
        <ul className="source-list">
          {items.map((item) => (
            <NameRow
              key={item.id}
              kind={kind}
              item={item}
              onError={setError}
              onSaved={(next) => onItems(items.map((row) => row.id === next.id ? next : row))}
              onDeleted={(id) => {
                onItems(items.filter((row) => row.id !== id))
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

function NameRow({ kind, item, onSaved, onDeleted, onError }) {
  const [name, setName] = useState(item.name)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setName(item.name) }, [item.name])

  async function commit() {
    const next = name.trim()
    if (next === item.name) return
    if (next.length < 2) {
      setName(item.name)
      return
    }
    setBusy(true)
    onError("")
    try {
      const body = await api(`${kind.path}/${item.id}`, { method: "PATCH", body: { name: next } })
      onSaved(body[kind.key])
    } catch (reason) {
      setName(item.name)
      onError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const sure = await askConfirm({
      title: `Delete ${item.name}?`,
      message: kind.deleteMessage,
      yes: "Yes, delete",
      danger: true,
    })
    if (!sure) return
    setBusy(true)
    onError("")
    try {
      await api(`${kind.path}/${item.id}`, { method: "DELETE" })
      onDeleted(item.id)
    } catch (reason) {
      onError(reason.message)
      setBusy(false)
    }
  }

  return (
    <li>
      <input
        value={name}
        aria-label={`Edit ${item.name}`}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur() } }}
      />
      <button type="button" className="text-btn danger" disabled={busy} onClick={remove} aria-label={`Delete ${item.name}`}>Delete</button>
    </li>
  )
}
