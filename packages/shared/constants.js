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

export const COURIER_STATUSES = {
  in_review: "রিভিউতে",
  pending: "অপেক্ষায়",
  hold: "হোল্ড",
  delivered_approval_pending: "ডেলিভারি নিশ্চিত হচ্ছে",
  partial_delivered_approval_pending: "আংশিক ডেলিভারি নিশ্চিত হচ্ছে",
  cancelled_approval_pending: "বাতিল নিশ্চিত হচ্ছে",
  unknown_approval_pending: "স্ট্যাটাস নিশ্চিত হচ্ছে",
  delivered: "ডেলিভার্ড",
  partial_delivered: "আংশিক ডেলিভার্ড",
  cancelled: "বাতিল, ফেরত আসছে",
  exceptional: "ব্যতিক্রম",
  unknown: "অজানা",
  cancelled_return_processing: "রিটার্ন প্রসেসে",
  cancelled_return_rider_assigned: "রিটার্ন রাইডারের কাছে",
  cancelled_return_received: "রিটার্ন পৌঁছেছে",
  partial_delivered_return_processing: "আংশিক রিটার্ন প্রসেসে",
  partial_delivered_return_rider_assigned: "আংশিক রিটার্ন রাইডারের কাছে",
  partial_delivered_return_received: "আংশিক রিটার্ন পৌঁছেছে",
}

export function courierStatusLabel(id) {
  if (!id) return ""
  return COURIER_STATUSES[id] || id
}
