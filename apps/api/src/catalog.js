import { LOW_STOCK_AT } from "@rose/shared"
import { pool } from "./db.js"
import { cleanName, fail, money, whole } from "./http.js"
import { dhakaToday, writePurchase } from "./purchases.js"

function availableFor(product, components) {
  if (!product.is_combo) return product.stock_qty
  if (!components.length) return 0
  return components.reduce((min, item) => Math.min(min, Math.floor(item.stockQty / item.quantity)), Infinity)
}

function shape(row, components = [], variants = []) {
  const isCombo = row.is_combo
  const costPrice = isCombo
    ? components.reduce((sum, item) => sum + item.costPrice * item.quantity, 0)
    : Number(row.cost_price)
  const stockQty = variants.length
    ? variants.reduce((sum, item) => sum + item.stockQty, 0)
    : row.stock_qty
  return {
    id: row.id,
    name: row.name,
    sku: row.sku || "",
    parentId: row.parent_id || null,
    costPrice,
    sellPrice: Number(row.sell_price),
    stockQty,
    isCombo,
    components,
    variants,
    available: variants.length ? stockQty : availableFor(row, components),
  }
}

export function readSku(value) {
  const sku = String(value ?? "").trim()
  if (sku.length > 40) throw fail(400, "SKU is too long")
  if (sku && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(sku)) throw fail(400, "SKU can use letters, numbers, and dashes")
  return sku
}

export async function loadCatalog(client = pool) {
  const products = await client.query(`
    SELECT id, name, sku, parent_id, cost_price::float8 AS cost_price, sell_price::float8 AS sell_price, stock_qty, is_combo
    FROM products
    ORDER BY is_combo, lower(name), id
  `)
  const links = await client.query(`
    SELECT combo_id, product_id, quantity
    FROM combo_items
    ORDER BY combo_id, product_id
  `)
  const byId = new Map(products.rows.map((row) => [row.id, row]))
  const grouped = new Map()
  for (const link of links.rows) {
    const part = byId.get(link.product_id)
    if (!part || part.is_combo) continue
    const list = grouped.get(link.combo_id) || []
    list.push({
      productId: part.id,
      name: part.name,
      quantity: link.quantity,
      stockQty: part.stock_qty,
      costPrice: Number(part.cost_price),
    })
    grouped.set(link.combo_id, list)
  }
  const variants = new Map()
  for (const row of products.rows) {
    if (!row.parent_id || row.is_combo) continue
    const list = variants.get(row.parent_id) || []
    list.push(shape(row))
    variants.set(row.parent_id, list)
  }
  return products.rows
    .filter((row) => !row.parent_id)
    .map((row) => shape(row, grouped.get(row.id) || [], variants.get(row.id) || []))
}

function readComponents(body, catalog) {
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw fail(400, "Choose which products go in the combo")
  }
  const merged = new Map()
  for (const item of body.items) {
    const productId = whole(item.productId)
    const quantity = whole(item.quantity)
    const product = catalog.find((entry) => entry.id === productId && !entry.parentId)
    const variant = catalog.flatMap((entry) => entry.variants || []).find((entry) => entry.id === productId)
    const piece = variant || product
    if (!piece || piece.isCombo || (product && product.variants?.length)) throw fail(400, "Choose a product or a variant, not the group")
    if (!quantity || quantity <= 0 || quantity > 99) throw fail(400, "Enter a valid quantity for the combo")
    merged.set(productId, (merged.get(productId) || 0) + quantity)
  }
  const items = [...merged].map(([productId, quantity]) => ({ productId, quantity }))
  const pieces = items.reduce((sum, item) => sum + item.quantity, 0)
  if (pieces < 2) throw fail(400, "A combo needs at least two pieces")
  return items
}

export async function createProduct(body) {
  const name = cleanName(body.name)
  const costPrice = money(body.costPrice)
  const sellPrice = money(body.sellPrice)
  const stockQty = whole(body.stockQty, 0)
  const sku = readSku(body.sku)
  if (!name) throw fail(400, "Enter a product name")
  if (costPrice === null || sellPrice === null) throw fail(400, "Enter a valid price")
  if (stockQty === null || stockQty < 0 || stockQty > 100000) throw fail(400, "Enter stock as a whole number")
  const client = await pool.connect()
  let productId
  try {
    await client.query("BEGIN")
    const inserted = await client.query(
      `INSERT INTO products (name, sku, cost_price, sell_price, stock_qty, is_combo)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING id`,
      [name, sku, costPrice, sellPrice, stockQty],
    )
    productId = inserted.rows[0].id
    if (stockQty > 0) {
      await writePurchase(client, {
        productId,
        boughtOn: dhakaToday(),
        quantity: stockQty,
        unitCost: costPrice,
        note: "",
        addStock: false,
      })
    }
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    if (error?.code === "23505") throw fail(400, "That SKU is already used")
    throw error
  } finally {
    client.release()
  }
  const catalog = await loadCatalog()
  return catalog.find((item) => item.id === productId)
}

export async function updateProduct(id, body) {
  const name = cleanName(body.name)
  const costPrice = money(body.costPrice)
  const sellPrice = money(body.sellPrice)
  const sku = body.sku === undefined ? null : readSku(body.sku)
  if (!name) throw fail(400, "Enter a product name")
  if (costPrice === null || sellPrice === null) throw fail(400, "Enter a valid price")
  let updated
  try {
    updated = await pool.query(
      `UPDATE products
       SET name = $2, sku = COALESCE($3, sku), cost_price = $4, sell_price = $5
       WHERE id = $1 AND is_combo = FALSE
       RETURNING id`,
      [id, name, sku, costPrice, sellPrice],
    )
  } catch (error) {
    if (error?.code === "23505") throw fail(400, "That SKU is already used")
    throw error
  }
  if (!updated.rows[0]) throw fail(404, "Product was not found")
  const catalog = await loadCatalog()
  return catalog.find((item) => item.id === id) || catalog.flatMap((item) => item.variants || []).find((item) => item.id === id)
}

export async function createVariant(parentId, body) {
  const name = cleanName(body.name)
  const sku = readSku(body.sku)
  const costPrice = money(body.costPrice)
  const sellPrice = money(body.sellPrice)
  const stockQty = whole(body.stockQty, 0)
  if (!name) throw fail(400, "Enter a variant name")
  if (!sku) throw fail(400, "Enter a SKU for the variant")
  if (costPrice === null || sellPrice === null) throw fail(400, "Enter a valid price")
  if (stockQty === null || stockQty < 0 || stockQty > 100000) throw fail(400, "Enter stock as a whole number")
  const parent = await pool.query(`SELECT id, is_combo, parent_id FROM products WHERE id = $1`, [parentId])
  const row = parent.rows[0]
  if (!row || row.is_combo || row.parent_id) throw fail(404, "Product was not found")
  const client = await pool.connect()
  let variantId
  try {
    await client.query("BEGIN")
    const inserted = await client.query(
      `INSERT INTO products (name, sku, parent_id, cost_price, sell_price, stock_qty, is_combo)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       RETURNING id`,
      [name, sku, parentId, costPrice, sellPrice, stockQty],
    )
    variantId = inserted.rows[0].id
    if (stockQty > 0) {
      await writePurchase(client, {
        productId: variantId,
        boughtOn: dhakaToday(),
        quantity: stockQty,
        unitCost: costPrice,
        note: "",
        addStock: false,
      })
    }
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    if (error?.code === "23505") throw fail(400, "That SKU is already used")
    throw error
  } finally {
    client.release()
  }
  const catalog = await loadCatalog()
  return catalog.find((item) => item.id === parentId)
}

export async function adjustStock(id, body) {
  const delta = whole(body.delta)
  if (delta === null || delta === 0 || Math.abs(delta) > 100000) {
    throw fail(400, "Enter how many pieces to add or remove")
  }
  const parent = await pool.query(`SELECT 1 FROM products WHERE parent_id = $1 LIMIT 1`, [id])
  if (parent.rows[0]) throw fail(400, "This product has variants. Change the stock on the variant")
  const updated = await pool.query(
    `UPDATE products
     SET stock_qty = stock_qty + $2
     WHERE id = $1 AND is_combo = FALSE AND stock_qty + $2 >= 0
     RETURNING id`,
    [id, delta],
  )
  if (!updated.rows[0]) throw fail(400, "Stock cannot go below zero")
  const catalog = await loadCatalog()
  return catalog.find((item) => item.id === id)
}

export async function createCombo(body) {
  const name = cleanName(body.name)
  const sellPrice = money(body.sellPrice)
  if (!name) throw fail(400, "Enter a combo name")
  if (sellPrice === null) throw fail(400, "Enter the combo's selling price")
  const catalog = await loadCatalog()
  const items = readComponents(body, catalog)
  const client = await pool.connect()
  let comboId
  try {
    await client.query("BEGIN")
    const inserted = await client.query(
      `INSERT INTO products (name, cost_price, sell_price, stock_qty, is_combo)
       VALUES ($1, 0, $2, 0, TRUE)
       RETURNING id`,
      [name, sellPrice],
    )
    comboId = inserted.rows[0].id
    for (const item of items) {
      await client.query(
        `INSERT INTO combo_items (combo_id, product_id, quantity) VALUES ($1, $2, $3)`,
        [comboId, item.productId, item.quantity],
      )
    }
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
  const next = await loadCatalog()
  return next.find((item) => item.id === comboId)
}

export async function updateCombo(id, body) {
  const name = cleanName(body.name)
  const sellPrice = money(body.sellPrice)
  if (!name) throw fail(400, "Enter a combo name")
  if (sellPrice === null) throw fail(400, "Enter the combo's selling price")
  const catalog = await loadCatalog()
  const existing = catalog.find((item) => item.id === id && item.isCombo)
  if (!existing) throw fail(404, "Combo was not found")
  const items = readComponents(body, catalog)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(`UPDATE products SET name = $2, sell_price = $3 WHERE id = $1 AND is_combo = TRUE`, [id, name, sellPrice])
    await client.query(`DELETE FROM combo_items WHERE combo_id = $1`, [id])
    for (const item of items) {
      await client.query(
        `INSERT INTO combo_items (combo_id, product_id, quantity) VALUES ($1, $2, $3)`,
        [id, item.productId, item.quantity],
      )
    }
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* already closed */ }
    throw error
  } finally {
    client.release()
  }
  const next = await loadCatalog()
  return next.find((item) => item.id === id)
}

export async function deleteProduct(id) {
  const catalog = await loadCatalog()
  const product = catalog.find((item) => item.id === id)
  if (!product) throw fail(404, "Product was not found")
  const variantIds = (product.variants || []).map((item) => item.id)
  if (variantIds.length) {
    const childUsed = await pool.query(
      `SELECT 1 FROM order_items WHERE product_id = ANY($1::int[])
       UNION ALL
       SELECT 1 FROM order_stock WHERE product_id = ANY($1::int[])
       LIMIT 1`,
      [variantIds],
    )
    if (childUsed.rows[0]) throw fail(400, "A variant of this product has orders, so it cannot be deleted")
  }
  const usedInCombo = catalog.some((item) => item.components.some((part) => part.productId === id || variantIds.includes(part.productId)))
  if (usedInCombo) throw fail(400, "This product is in a combo. Remove it from the combo first")
  const used = await pool.query(
    `SELECT 1 FROM order_items WHERE product_id = $1
     UNION ALL
     SELECT 1 FROM order_stock WHERE product_id = $1
     LIMIT 1`,
    [id],
  )
  if (used.rows[0]) throw fail(400, "This product has orders, so it cannot be deleted")
  const bought = await pool.query(`SELECT 1 FROM purchases WHERE product_id = $1 LIMIT 1`, [id])
  if (bought.rows[0]) throw fail(400, "This product is in the books. Remove those purchases first")
  await pool.query(`DELETE FROM products WHERE id = $1`, [id])
}

export async function inventorySummary() {
  const catalog = await loadCatalog()
  const pieces = catalog.filter((item) => !item.isCombo)
  return {
    productCount: pieces.length,
    comboCount: catalog.length - pieces.length,
    pieces: pieces.reduce((sum, item) => sum + item.stockQty, 0),
    costValue: pieces.reduce((sum, item) => sum + item.stockQty * item.costPrice, 0),
    sellValue: pieces.reduce((sum, item) => sum + item.stockQty * item.sellPrice, 0),
    low: pieces
      .filter((item) => item.stockQty <= LOW_STOCK_AT)
      .sort((a, b) => a.stockQty - b.stockQty || a.name.localeCompare(b.name))
      .map((item) => ({ id: item.id, name: item.name, stockQty: item.stockQty })),
    combos: catalog
      .filter((item) => item.isCombo)
      .sort((a, b) => a.available - b.available || a.name.localeCompare(b.name))
      .map((item) => {
        const short = [...item.components].sort((a, b) => a.stockQty / a.quantity - b.stockQty / b.quantity)[0]
        return { id: item.id, name: item.name, available: item.available, heldBy: short?.name || "" }
      }),
    lowAt: LOW_STOCK_AT,
  }
}
