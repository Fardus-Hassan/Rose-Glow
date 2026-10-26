export function lineKey(line) {
  return `${line.productId}:${line.gift ? "gift" : "sale"}`
}

export function addTo(lines, next) {
  const key = lineKey(next)
  if (lines.some((line) => lineKey(line) === key)) {
    return lines.map((line) => lineKey(line) === key ? { ...line, quantity: line.quantity + next.quantity } : line)
  }
  return [...lines, next]
}

export function toggleGiftIn(lines, key) {
  const line = lines.find((item) => lineKey(item) === key)
  if (!line) return lines
  return addTo(lines.filter((item) => item !== line), { ...line, gift: !line.gift })
}
