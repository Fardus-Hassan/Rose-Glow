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

function databaseUrl() {
  const raw = process.env.DATABASE_URL
  if (!raw) return ""
  try {
    const url = new URL(raw)
    url.searchParams.delete("channel_binding")
    return url.toString()
  } catch {
    return raw
  }
}

const connectionString = databaseUrl()
if (!connectionString) {
  throw new Error("DATABASE_URL is missing. The app cannot start without PostgreSQL.")
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

CREATE TABLE IF NOT EXISTS order_sources (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  courier TEXT NOT NULL DEFAULT '',
  source_id INTEGER REFERENCES order_sources(id),
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

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_gift BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS order_stock (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS orders_ordered_at_idx ON orders (ordered_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

CREATE TABLE IF NOT EXISTS courier_accounts (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  api_key_enc TEXT NOT NULL,
  secret_key_enc TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  webhook_token_enc TEXT,
  balance NUMERIC(14,2),
  checked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courier_events (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  consignment_id BIGINT,
  status TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  idempotency_key TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS courier_events_idem ON courier_events (idempotency_key);
CREATE INDEX IF NOT EXISTS courier_events_recent ON courier_events (created_at DESC);

CREATE TABLE IF NOT EXISTS courier_sync (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01'
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  bought_on DATE NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchases_bought_on_idx ON purchases (bought_on DESC, id DESC);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS bought_from TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS buying_expenses (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  spent_on DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('vehicle', 'courier', 'other')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS buying_expenses_spent_on_idx ON buying_expenses (spent_on DESC, id DESC);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'buying_expenses_kind_check' AND pg_get_constraintdef(oid) LIKE '%salary%'
  ) THEN
    ALTER TABLE buying_expenses DROP CONSTRAINT IF EXISTS buying_expenses_kind_check;
    ALTER TABLE buying_expenses ADD CONSTRAINT buying_expenses_kind_check CHECK (kind IN ('vehicle', 'courier', 'other', 'salary'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS owner_withdrawals (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  taken_on DATE NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('personal', 'family', 'home', 'loan', 'savings', 'other')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_withdrawals_taken_on_idx ON owner_withdrawals (taken_on DESC, id DESC);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_charge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cod_charge >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_paid_by TEXT NOT NULL DEFAULT 'free' CHECK (cod_paid_by IN ('free','customer'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_paid_by TEXT NOT NULL DEFAULT 'customer' CHECK (delivery_paid_by IN ('free','customer'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_id INTEGER REFERENCES order_sources(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS consignment_id BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_status_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_error TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_sent_at TIMESTAMPTZ;
UPDATE orders o
SET courier_sent_at = COALESCE(
  (SELECT MIN(e.created_at) FROM courier_events e WHERE e.order_id = o.id),
  o.courier_status_at,
  o.ordered_at
)
WHERE o.courier_sent_at IS NULL
  AND (o.consignment_id IS NOT NULL OR o.status IN ('courier', 'delivered'));
CREATE INDEX IF NOT EXISTS orders_courier_sent_idx ON orders (courier_sent_at) WHERE courier_sent_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS orders_consignment_idx ON orders (consignment_id) WHERE consignment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS order_sources_name_lower ON order_sources (lower(name));
CREATE TABLE IF NOT EXISTS ad_spends (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  spent_on DATE NOT NULL,
  source_id INTEGER NOT NULL REFERENCES order_sources(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_spends_spent_on_idx ON ad_spends (spent_on DESC, id DESC);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_charge NUMERIC(12,2) CHECK (courier_charge >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_charge_by TEXT CHECK (courier_charge_by IN ('steadfast', 'manual'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_cod NUMERIC(12,2) CHECK (courier_cod >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_booked NUMERIC(12,2) CHECK (cod_booked >= 0);
ALTER TABLE courier_events ADD COLUMN IF NOT EXISTS payload JSONB;

-- The one place an order's money is worked out. Every report reads from here.
-- courier_cost uses what Steadfast actually charged once known, else the charge typed on the order.
-- A cancelled or returned order sells nothing, but a courier charge on it is still a loss.
CREATE OR REPLACE VIEW order_money AS
SELECT o.id, o.status, o.source_id, o.ordered_at, o.paid_amount, o.discount,
       t.goods, t.cost, t.gifts,
       t.goods - o.discount AS sales,
       CASE WHEN o.delivery_paid_by = 'customer' THEN o.delivery_charge ELSE 0 END AS bill_delivery,
       CASE WHEN o.cod_paid_by = 'customer' THEN o.cod_charge ELSE 0 END AS bill_cod,
       COALESCE(o.courier_charge, o.delivery_charge) + o.cod_charge AS courier_cost,
       o.status NOT IN ('cancelled', 'returned') AS counted,
       t.goods - o.discount
         + CASE WHEN o.delivery_paid_by = 'customer' THEN o.delivery_charge ELSE 0 END
         + CASE WHEN o.cod_paid_by = 'customer' THEN o.cod_charge ELSE 0 END AS total,
       CASE WHEN o.status IN ('cancelled', 'returned') THEN -COALESCE(o.courier_charge, 0)
            ELSE t.goods - o.discount - t.cost
              + CASE WHEN o.delivery_paid_by = 'customer' THEN o.delivery_charge ELSE 0 END
              + CASE WHEN o.cod_paid_by = 'customer' THEN o.cod_charge ELSE 0 END
              - COALESCE(o.courier_charge, o.delivery_charge) - o.cod_charge
       END AS profit
FROM orders o
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0) AS goods,
         COALESCE(SUM(oi.unit_cost * oi.quantity), 0) AS cost,
         COALESCE(SUM(CASE WHEN oi.is_gift THEN oi.unit_cost * oi.quantity ELSE 0 END), 0) AS gifts
  FROM order_items oi
  WHERE oi.order_id = o.id
) t;

INSERT INTO order_sources (name, position)
SELECT seed.name, seed.position
FROM (VALUES ('Facebook', 1), ('TikTok', 2), ('WhatsApp', 3), ('IMO', 4)) AS seed(name, position)
WHERE NOT EXISTS (
  SELECT 1 FROM order_sources existing WHERE lower(existing.name) = lower(seed.name)
);
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
