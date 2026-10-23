import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const { Pool } = pg
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

function loadEnv() {
  const file = path.join(root, ".env")
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnv()

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error("DATABASE_URL নেই। PostgreSQL ছাড়া অ্যাপ চালু হবে না।")
}

const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(connectionString)

export const pool = new Pool({
  connectionString,
  max: process.env.VERCEL ? 1 : 10,
  ssl: local ? false : { rejectUnauthorized: false },
})

const schema = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  sell_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  is_combo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS combo_items (
  combo_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (combo_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  courier TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('new','confirmed','courier','delivered','cancelled','returned')),
  ordered_at TIMESTAMPTZ NOT NULL,
  delivery_charge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  delivery_paid_by TEXT NOT NULL DEFAULT 'customer' CHECK (delivery_paid_by IN ('free','customer')),
  discount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cod','bkash','nagad','cash')),
  cod_charge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cod_charge >= 0),
  cod_paid_by TEXT NOT NULL DEFAULT 'free' CHECK (cod_paid_by IN ('free','customer')),
  note TEXT NOT NULL DEFAULT '',
  stock_held BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0)
);

CREATE TABLE IF NOT EXISTS order_stock (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS orders_ordered_at_idx ON orders (ordered_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_charge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cod_charge >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_paid_by TEXT NOT NULL DEFAULT 'free' CHECK (cod_paid_by IN ('free','customer'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_paid_by TEXT NOT NULL DEFAULT 'customer' CHECK (delivery_paid_by IN ('free','customer'));
`

let pending = null

export function migrate() {
  if (!pending) {
    pending = pool.query(schema).then(() => {}).catch((error) => {
      pending = null
      throw error
    })
  }
  return pending
}
