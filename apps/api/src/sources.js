import { pool } from "./db.js"
import { cleanName, fail, whole } from "./http.js"

function present(row) {
  return { id: row.id, name: row.name, position: row.position }
}

export async function listSources() {
  const result = await pool.query(`SELECT id, name, position FROM order_sources ORDER BY position, id`)
  return result.rows.map(present)
}

export async function createSource(body) {
  const name = cleanName(body.name)
  if (!name) throw fail(400, "Enter a source name")
  const next = await pool.query(`SELECT COALESCE(MAX(position), 0) + 1 AS position FROM order_sources`)
  try {
    const inserted = await pool.query(
      `INSERT INTO order_sources (name, position) VALUES ($1, $2) RETURNING id, name, position`,
      [name, next.rows[0].position],
    )
    return present(inserted.rows[0])
  } catch (error) {
    if (error.code === "23505") throw fail(400, "A source with this name already exists")
    throw error
  }
}

export async function updateSource(id, body) {
  const name = cleanName(body.name)
  if (!name) throw fail(400, "Enter a source name")
  try {
    const updated = await pool.query(
      `UPDATE order_sources SET name = $2 WHERE id = $1 RETURNING id, name, position`,
      [id, name],
    )
    if (!updated.rows[0]) throw fail(404, "Source was not found")
    return present(updated.rows[0])
  } catch (error) {
    if (error.code === "23505") throw fail(400, "A source with this name already exists")
    throw error
  }
}

export async function deleteSource(id) {
  const sourceId = whole(id)
  if (!sourceId) throw fail(400, "Source is not valid")
  const used = await pool.query(`SELECT 1 FROM orders WHERE source_id = $1 LIMIT 1`, [sourceId])
  if (used.rows[0]) throw fail(400, "This source has orders, so it cannot be deleted")
  const spent = await pool.query(`SELECT 1 FROM ad_spends WHERE source_id = $1 LIMIT 1`, [sourceId])
  if (spent.rows[0]) throw fail(400, "This source has ad costs, so it cannot be deleted")
  const removed = await pool.query(`DELETE FROM order_sources WHERE id = $1 RETURNING id`, [sourceId])
  if (!removed.rows[0]) throw fail(404, "Source was not found")
}
