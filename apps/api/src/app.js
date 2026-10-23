import { migrate, pool } from "./db.js"
import { loadCatalog, adjustStock, createCombo, createProduct, deleteProduct, updateCombo, updateProduct } from "./catalog.js"
import { dashboard, rangeStats } from "./dashboard.js"
import { createSource, deleteSource, listSources, updateSource } from "./sources.js"
import { fail, whole, wrap } from "./http.js"
import { createOrder, deleteOrder, getOrder, listOrders, updateOrder } from "./orders.js"

function idFrom(req) {
  const id = whole(Number(req.params.id))
  if (!id || id <= 0) throw fail(400, "নম্বরটা ঠিক নেই")
  return id
}

export function mount(app) {
  app.use("/api", wrap(async (req, res, next) => {
    await migrate()
    next()
  }))

  app.get("/api/health", wrap(async (req, res) => {
    await pool.query("SELECT 1")
    res.json({ ok: true, database: "postgresql" })
  }))

  app.get("/api/dashboard", wrap(async (req, res) => {
    res.json(await dashboard())
  }))

  app.get("/api/stats", wrap(async (req, res) => {
    res.json(await rangeStats(req.query.from, req.query.to))
  }))

  app.get("/api/sources", wrap(async (req, res) => {
    res.json({ sources: await listSources() })
  }))

  app.post("/api/sources", wrap(async (req, res) => {
    res.status(201).json({ source: await createSource(req.body || {}) })
  }))

  app.patch("/api/sources/:id", wrap(async (req, res) => {
    res.json({ source: await updateSource(idFrom(req), req.body || {}) })
  }))

  app.delete("/api/sources/:id", wrap(async (req, res) => {
    await deleteSource(idFrom(req))
    res.json({ ok: true })
  }))

  app.get("/api/products", wrap(async (req, res) => {
    res.json({ products: await loadCatalog() })
  }))

  app.post("/api/products", wrap(async (req, res) => {
    res.status(201).json({ product: await createProduct(req.body || {}) })
  }))

  app.patch("/api/products/:id", wrap(async (req, res) => {
    res.json({ product: await updateProduct(idFrom(req), req.body || {}) })
  }))

  app.post("/api/products/:id/stock", wrap(async (req, res) => {
    res.json({ product: await adjustStock(idFrom(req), req.body || {}) })
  }))

  app.post("/api/combos", wrap(async (req, res) => {
    res.status(201).json({ product: await createCombo(req.body || {}) })
  }))

  app.patch("/api/combos/:id", wrap(async (req, res) => {
    res.json({ product: await updateCombo(idFrom(req), req.body || {}) })
  }))

  app.delete("/api/products/:id", wrap(async (req, res) => {
    await deleteProduct(idFrom(req))
    res.json({ ok: true })
  }))

  app.get("/api/orders", wrap(async (req, res) => {
    const limit = Math.min(Math.max(whole(req.query.limit, 30) || 30, 1), 200)
    const offset = Math.max(whole(req.query.offset, 0) || 0, 0)
    res.json(await listOrders({
      status: req.query.status || "all",
      q: req.query.q || "",
      source: req.query.source || "all",
      from: req.query.from || "",
      to: req.query.to || "",
      limit,
      offset,
    }))
  }))

  app.post("/api/orders", wrap(async (req, res) => {
    res.status(201).json({ order: await createOrder(req.body || {}) })
  }))

  app.get("/api/orders/:id", wrap(async (req, res) => {
    res.json({ order: await getOrder(idFrom(req)) })
  }))

  app.patch("/api/orders/:id", wrap(async (req, res) => {
    res.json({ order: await updateOrder(idFrom(req), req.body || {}) })
  }))

  app.delete("/api/orders/:id", wrap(async (req, res) => {
    await deleteOrder(idFrom(req))
    res.json({ ok: true })
  }))

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "এই ঠিকানা পাওয়া যায়নি" })
  })

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    const status = error.status || 500
    if (status >= 500) console.error(error)
    const offline = ["ECONNREFUSED", "ENOTFOUND", "57P01", "28P01", "3D000"].includes(error.code)
    const message = offline ? "ডেটাবেসে যোগাযোগ করা যাচ্ছে না" : status >= 500 ? "সার্ভারে সমস্যা হয়েছে" : error.message
    res.status(status).json({ error: message })
  })
}
