import { LOW_STOCK_AT } from "@rose/shared"
import { pool } from "./db.js"
import { cleanName, fail, money, whole } from "./http.js"

function availableFor(product, components) {
  if (!product.is_combo) return product.stock_qty
  if (!components.length) return 0
  return components.reduce((min, item) => Math.min(min, Math.floor(item.stockQty / item.quantity)), Infinity)
}

function shape(row, components = []) {
  const isCombo = row.is_combo
  const costPrice = isCombo
    ? components.reduce((sum, item) => sum + item.costPrice * item.quantity, 0)
    : Number(row.cost_price)
  return {
    id: row.id,
    name: row.name,
    costPrice,
    sellPrice: Number(row.sell_price),
    stockQty: row.stock_qty,
    isCombo,
    components,
    available: availableFor(row, components),
  }
}

export async function loadCatalog(client = pool) {
  const products = await client.query(`
    SELECT id, name, cost_price::float8 AS cost_price, sell_price::float8 AS sell_price, stock_qty, is_combo
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
  return products.rows.map((row) => shape(row, grouped.get(row.id) || []))
}

function readComponents(body, catalog) {
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw fail(400, "কম্বোতে কোন পণ্য যাবে সেটা দিন")
  }
  const merged = new Map()
  for (const item of body.items) {
    const productId = whole(item.productId)
    const quantity = whole(item.quantity)
    const product = catalog.find((entry) => entry.id === productId)
    if (!product || product.isCombo) throw fail(400, "কম্বোর ভিতরে আরেকটা কম্বো যাবে না")
    if (!quantity || quantity <= 0 || quantity > 99) throw fail(400, "কম্বোর পিস ঠিকমতো দিন")
    merged.set(productId, (merged.get(productId) || 0) + quantity)
  }
  const items = [...merged].map(([productId, quantity]) => ({ productId, quantity }))
  const pieces = items.reduce((sum, item) => sum + item.quantity, 0)
  if (pieces < 2) throw fail(400, "কম্বোতে অন্তত দুই পিস মাল লাগবে")
  return items
}

export async function createProduct(body) {
  const name = cleanName(body.name)
  const costPrice = money(body.costPrice)
  const sellPrice = money(body.sellPrice)
  const stockQty = whole(body.stockQty, 0)
  if (!name) throw fail(400, "পণ্যের নাম দিন")
  if (costPrice === null || sellPrice === null) throw fail(400, "দাম ঠিকমতো দিন")
  if (stockQty === null || stockQty < 0 || stockQty > 100000) throw fail(400, "স্টক পুরো সংখ্যায় দিন")
  const inserted = await pool.query(
    `INSERT INTO products (name, cost_price, sell_price, stock_qty, is_combo)
     VALUES ($1, $2, $3, $4, FALSE)
     RETURNING id`,
    [name, costPrice, sellPrice, stockQty],
  )
  const catalog = await loadCatalog()
  return catalog.find((item) => item.id === inserted.rows[0].id)
}

export async function updateProduct(id, body) {
  const name = cleanName(body.name)
  const costPrice = money(body.costPrice)
  const sellPrice = money(body.sellPrice)
  if (!name) throw fail(400, "পণ্যের নাম দিন")
  if (costPrice === null || sellPrice === null) throw fail(400, "দাম ঠিকমতো দিন")
  const updated = await pool.query(
    `UPDATE products
     SET name = $2, cost_price = $3, sell_price = $4
     WHERE id = $1 AND is_combo = FALSE
     RETURNING id`,
    [id, name, costPrice, sellPrice],
  )
  if (!updated.rows[0]) throw fail(404, "পণ্য পাওয়া যায়নি")
  const catalog = await loadCatalog()
  return catalog.find((item) => item.id === id)
}

export async function adjustStock(id, body) {
  const delta = whole(body.delta)
  if (delta === null || delta === 0 || Math.abs(delta) > 100000) {
    throw fail(400, "কত পিস যোগ বা বিয়োগ হবে সেটা দিন")
  }
  const updated = await pool.query(
    `UPDATE products
     SET stock_qty = stock_qty + $2
     WHERE id = $1 AND is_combo = FALSE AND stock_qty + $2 >= 0
     RETURNING id`,
    [id, delta],
  )
  if (!updated.rows[0]) throw fail(400, "স্টক শূন্যের নিচে নামানো যাবে না")
  const catalog = await loadCatalog()
  return catalog.find((item) => item.id === id)
}

export async function createCombo(body) {
  const name = cleanName(body.name)
  const sellPrice = money(body.sellPrice)
  if (!name) throw fail(400, "কম্বোর নাম দিন")
  if (sellPrice === null) throw fail(400, "কম্বোর বিক্রির দাম দিন")
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
  if (!name) throw fail(400, "কম্বোর নাম দিন")
  if (sellPrice === null) throw fail(400, "কম্বোর বিক্রির দাম দিন")
  const catalog = await loadCatalog()
  const existing = catalog.find((item) => item.id === id && item.isCombo)
  if (!existing) throw fail(404, "কম্বো পাওয়া যায়নি")
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
  if (!product) throw fail(404, "পণ্য পাওয়া যায়নি")
  const usedInCombo = catalog.some((item) => item.components.some((part) => part.productId === id))
  if (usedInCombo) throw fail(400, "এই পণ্য একটা কম্বোতে আছে, আগে কম্বো থেকে সরান")
  const used = await pool.query(
    `SELECT 1 FROM order_items WHERE product_id = $1
     UNION ALL
     SELECT 1 FROM order_stock WHERE product_id = $1
     LIMIT 1`,
    [id],
  )
  if (used.rows[0]) throw fail(400, "এই পণ্যের অর্ডার আছে, মুছে ফেলা যাবে না")
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
      .map((item) => ({ id: item.id, name: item.name, available: item.available })),
    lowAt: LOW_STOCK_AT,
  }
}
