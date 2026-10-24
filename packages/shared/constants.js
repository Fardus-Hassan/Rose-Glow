export const STATUSES = [
  { id: "new", label: "New", color: "#e4b3ae" },
  { id: "confirmed", label: "Confirmed", color: "#2d6d8a" },
  { id: "courier", label: "With courier", color: "#6d4b8a" },
  { id: "delivered", label: "Delivered", color: "#2d7a52" },
  { id: "cancelled", label: "Cancelled", color: "#8d847c" },
  { id: "returned", label: "Returned", color: "#a33d45" },
]

export const PAYMENTS = [
  { id: "cod", label: "Cash on delivery" },
  { id: "bkash", label: "bKash" },
  { id: "nagad", label: "Nagad" },
  { id: "cash", label: "Cash" },
]

export const COURIERS = ["Steadfast", "Pathao", "RedX", "Paperfly", "Sundarban", "By hand"]

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

export const COURIER_STATUSES = {
  in_review: "In review",
  pending: "Pending",
  hold: "On hold",
  delivered_approval_pending: "Delivery being confirmed",
  partial_delivered_approval_pending: "Partial delivery being confirmed",
  cancelled_approval_pending: "Cancellation being confirmed",
  unknown_approval_pending: "Status being confirmed",
  delivered: "Delivered",
  partial_delivered: "Partially delivered",
  cancelled: "Cancelled, coming back",
  exceptional: "Exception",
  unknown: "Unknown",
  cancelled_return_processing: "Return in progress",
  cancelled_return_rider_assigned: "Return with rider",
  cancelled_return_received: "Return received",
  partial_delivered_return_processing: "Partial return in progress",
  partial_delivered_return_rider_assigned: "Partial return with rider",
  partial_delivered_return_received: "Partial return received",
}

export function courierStatusLabel(id) {
  if (!id) return ""
  return COURIER_STATUSES[id] || id
}
