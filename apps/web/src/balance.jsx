import { useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import { api } from "./api.js"
import { taka } from "./format.js"
import { useRoute } from "./route.jsx"

const SHOW_MS = 8000

export default function BalancePill() {
  const { go } = useRoute()
  const [state, setState] = useState("idle")
  const [balance, setBalance] = useState(null)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function check() {
    if (state === "loading") return
    if (state === "shown") {
      clearTimeout(timer.current)
      setState("idle")
      return
    }
    setState("loading")
    try {
      const body = await api("/api/courier/balance", { method: "POST", body: {} })
      setBalance(body.balance)
      setState("shown")
      timer.current = setTimeout(() => setState("idle"), SHOW_MS)
    } catch (reason) {
      setState("idle")
      toast.error(reason.message)
      if (/keys/i.test(reason.message)) go("/courier")
    }
  }

  const label = state === "loading" ? "Checking…" : state === "shown" ? taka(balance ?? 0).replace(/^৳/, "") : (
    <>
      <span className="balance-long">Tap for balance</span>
      <span className="balance-short">Balance</span>
    </>
  )

  return (
    <button
      type="button"
      className={`balance-pill ${state}`}
      onClick={check}
      aria-live="polite"
      aria-label={state === "shown" ? `Steadfast balance ${taka(balance ?? 0)}` : "Check Steadfast balance"}
      title="Steadfast balance"
    >
      <span className="balance-coin" aria-hidden="true">৳</span>
      <span className="balance-text">{label}</span>
      {state === "shown" ? <span className="balance-bar" style={{ animationDuration: `${SHOW_MS}ms` }} /> : null}
    </button>
  )
}
