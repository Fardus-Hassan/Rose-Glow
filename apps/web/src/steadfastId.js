import { useEffect, useState } from "react"
import { api } from "./api.js"

let current = null
let request = null
const listeners = new Set()

export function setSteadfastId(value) {
  current = value
  listeners.forEach((listener) => listener(value))
}

export function useSteadfastId() {
  const [value, setValue] = useState(current ?? "")

  useEffect(() => {
    listeners.add(setValue)
    if (current === null && !request) {
      request = api("/api/courier/user-id")
        .then((body) => setSteadfastId(body.userId || ""))
        .catch(() => {})
        .finally(() => { request = null })
    }
    return () => { listeners.delete(setValue) }
  }, [])

  return value
}
