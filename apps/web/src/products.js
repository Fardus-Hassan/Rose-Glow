export function sellableProducts(products) {
  const rows = []
  for (const product of products || []) {
    if (product.variants?.length) {
      for (const variant of product.variants) {
        rows.push({
          ...variant,
          name: `${product.name} · ${variant.name}`,
          isCombo: false,
          components: [],
          variants: [],
        })
      }
    } else {
      rows.push(product)
    }
  }
  return rows
}
