import { useState } from "react"
import toast from "react-hot-toast"
import { api } from "./api.js"

export function Login({ onIn }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await api("/api/auth/login", { method: "POST", body: { password } })
      onIn()
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <img className="mark" src="/mark.png" alt="" />
        <h1>Rose Glow</h1>
        <p>Enter the ledger password.</p>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
        </label>
        {error ? <p className="banner banner-bad">{error}</p> : null}
        <button className="btn wide" type="submit" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
      </form>
    </div>
  )
}

export function Password() {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [again, setAgain] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (next !== again) {
      toast.error("The two new passwords do not match")
      return
    }
    setBusy(true)
    try {
      await api("/api/auth/password", { method: "POST", body: { current, next } })
      setCurrent("")
      setNext("")
      setAgain("")
      toast.success("Password changed")
    } catch (reason) {
      toast.error(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      <div className="page-head">
        <h1>Password</h1>
      </div>
      <form className="card gate-form" onSubmit={submit}>
        <label className="field">
          <span>Current password</span>
          <input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>New password</span>
          <input type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" minLength={6} maxLength={72} required />
        </label>
        <label className="field">
          <span>New password again</span>
          <input type="password" value={again} onChange={(event) => setAgain(event.target.value)} autoComplete="new-password" minLength={6} maxLength={72} required />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </section>
  )
}
