import { migrate, pool } from "./db.js"
import { loadCatalog, adjustStock, createCombo, createProduct, deleteProduct, updateCombo, updateProduct } from "./catalog.js"
import { dashboard, orderTotals, rangeStats } from "./dashboard.js"
import { createSource, deleteSource, listSources, updateSource } from "./sources.js"
import { fail, whole, wrap } from "./http.js"
import { createOrder, deleteOrder, getOrder, listOrders, updateOrder } from "./orders.js"
import {
  accountView,
  activeCouriers,
  bookIfNeeded,
  bookOrder,
  disconnectAccount,
  markNotifications,
  notificationFeed,
  parcelList,
  receiveWebhook,
  refreshBalance,
  requestReturn,
  saveAccount,
  trackOrder,
} from "./courier.js"
import { courierFilterView, saveCourierFilters } from "./settings.js"
import { createExpense, createPurchase, deleteExpense, deletePurchase, listPurchases } from "./purchases.js"

function idFrom(req) {
  const id = whole(Number(req.params.id))
  if (!id || id <= 0) throw fail(400, "That number is not valid")
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

  app.get("/api/purchases", wrap(async (req, res) => {
    const limit = Math.min(Math.max(whole(req.query.limit, 20) || 20, 1), 200)
    const offset = Math.max(whole(req.query.offset, 0) || 0, 0)
    const expenseLimit = Math.min(Math.max(whole(req.query.expenseLimit, 20) || 20, 1), 200)
    const expenseOffset = Math.max(whole(req.query.expenseOffset, 0) || 0, 0)
    const [page, trade] = await Promise.all([
      listPurchases({ limit, offset, expenseLimit, expenseOffset }),
      orderTotals(),
    ])
    res.json({ ...page, sales: trade.sales, profit: trade.profit - page.expensesTotal })
  }))

  app.post("/api/buying-expenses", wrap(async (req, res) => {
    res.status(201).json(await createExpense(req.body || {}))
  }))

  app.delete("/api/buying-expenses/:id", wrap(async (req, res) => {
    await deleteExpense(idFrom(req))
    res.json({ ok: true })
  }))

  app.post("/api/purchases", wrap(async (req, res) => {
    res.status(201).json(await createPurchase(req.body || {}))
  }))

  app.delete("/api/purchases/:id", wrap(async (req, res) => {
    await deletePurchase(idFrom(req))
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

  app.get("/api/courier/active", wrap(async (req, res) => {
    res.json({ couriers: await activeCouriers() })
  }))

  app.get("/api/courier/account", wrap(async (req, res) => {
    res.json(await accountView(req))
  }))

  app.put("/api/courier/account", wrap(async (req, res) => {
    res.json(await saveAccount(req.body || {}, req))
  }))

  app.delete("/api/courier/account", wrap(async (req, res) => {
    res.json(await disconnectAccount())
  }))

  app.post("/api/courier/balance", wrap(async (req, res) => {
    res.json(await refreshBalance())
  }))

  app.get("/api/courier/parcels", wrap(async (req, res) => {
    const limit = Math.min(Math.max(whole(req.query.limit, 10) || 10, 1), 200)
    const offset = Math.max(whole(req.query.offset, 0) || 0, 0)
    res.json(await parcelList({ limit, offset }))
  }))

  app.get("/api/courier/filters", wrap(async (req, res) => {
    res.json(await courierFilterView())
  }))

  app.put("/api/courier/filters", wrap(async (req, res) => {
    res.json(await saveCourierFilters(req.body || {}))
  }))

  app.get("/api/courier/notifications", wrap(async (req, res) => {
    res.json(await notificationFeed())
  }))

  app.post("/api/courier/notifications/read", wrap(async (req, res) => {
    res.json(await markNotifications(req.body?.ids))
  }))

  app.post("/api/courier/steadfast/webhook", wrap(async (req, res) => {
    res.json(await receiveWebhook(req))
  }))

  app.post("/api/orders", wrap(async (req, res) => {
    const order = await createOrder(req.body || {})
    res.status(201).json({ order: await bookIfNeeded(order) })
  }))

  app.get("/api/orders/:id", wrap(async (req, res) => {
    res.json({ order: await getOrder(idFrom(req)) })
  }))

  app.post("/api/orders/:id/dispatch", wrap(async (req, res) => {
    res.json({ order: await bookOrder(idFrom(req)) })
  }))

  app.post("/api/orders/:id/track", wrap(async (req, res) => {
    res.json(await trackOrder(idFrom(req)))
  }))

  app.post("/api/orders/:id/return", wrap(async (req, res) => {
    res.json({ order: await requestReturn(idFrom(req), req.body?.reason) })
  }))

  app.patch("/api/orders/:id", wrap(async (req, res) => {
    const order = await updateOrder(idFrom(req), req.body || {})
    res.json({ order: await bookIfNeeded(order) })
  }))

  app.delete("/api/orders/:id", wrap(async (req, res) => {
    await deleteOrder(idFrom(req))
    res.json({ ok: true })
  }))

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "That address was not found" })
  })

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    const status = error.status || 500
    if (status >= 500) console.error(error)
    const offline = ["ECONNREFUSED", "ENOTFOUND", "57P01", "28P01", "3D000"].includes(error.code)
    const message = offline ? "Cannot reach the database" : status >= 500 ? "Something went wrong on the server" : error.message
    res.status(status).json({ error: message })
  })
}
