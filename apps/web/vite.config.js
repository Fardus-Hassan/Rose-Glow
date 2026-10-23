import { fileURLToPath, URL } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const root = fileURLToPath(new URL("../..", import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    fs: { allow: [root] },
    proxy: {
      "/api": "http://127.0.0.1:4000",
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../../public", import.meta.url)),
    emptyOutDir: true,
  },
})
