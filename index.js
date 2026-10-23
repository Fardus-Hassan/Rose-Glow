import express from "express"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { mount } from "./apps/api/src/app.js"

const app = express()
app.use(express.json({ limit: "100kb" }))
mount(app)

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public")
const indexHtml = path.join(publicDir, "index.html")

if (!process.env.VERCEL && fs.existsSync(indexHtml)) {
  app.use(express.static(publicDir))
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next()
    res.sendFile(indexHtml)
  })
}

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 4000)
  app.listen(port, "0.0.0.0", () => {
    console.log(`Rose Glow http://127.0.0.1:${port}`)
  })
}

export default app
