export const STATUSES = [
  { id: "new", label: "নতুন", color: "#e4b3ae" },
  { id: "confirmed", label: "কনফার্ম", color: "#2d6d8a" },
  { id: "courier", label: "কুরিয়ারে", color: "#6d4b8a" },
  { id: "delivered", label: "ডেলিভার্ড", color: "#2d7a52" },
  { id: "cancelled", label: "বাতিল", color: "#8d847c" },
  { id: "returned", label: "রিটার্ন", color: "#a33d45" },
]

export const PAYMENTS = [
  { id: "cod", label: "ক্যাশ অন ডেলিভারি" },
  { id: "bkash", label: "বিকাশ" },
  { id: "nagad", label: "নগদ" },
  { id: "cash", label: "ক্যাশ" },
]

export const COURIERS = ["Steadfast", "Pathao", "RedX", "Paperfly", "Sundarban", "নিজে হাতে"]

export const LOW_STOCK_AT = 3

export function holdsStock(status) {
  return status !== "cancelled" && status !== "returned"
}

export function statusLabel(id) {
  return STATUSES.find((item) => item.id === id)?.label || id
}

export function paymentLabel(id) {
  return PAYMENTS.find((item) => item.id === id)?.label || id
}
