export async function api(path, options = {}) {
  let response
  try {
    response = await fetch(path, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new Error("সার্ভারের সাথে যোগাযোগ হচ্ছে না")
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || "কোনো একটা সমস্যা হয়েছে")
  return data
}

export function nowInput() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromInputValue(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString()
}

export function toInputValue(iso) {
  const date = new Date(iso)
  const pad = (value) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
