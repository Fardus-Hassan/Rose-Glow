import { pool } from "./db.js"
import { cleanName, fail, whole } from "./http.js"

function present(row) {
  return { id: row.id, name: row.name, position: row.position }
}

export async function listTags() {
  const result = await pool.query(`SELECT id, name, position FROM order_tags ORDER BY position, id`)
  return result.rows.map(present)
}

export async function createTag(body) {
  const name = cleanName(body.name)
  if (!name) throw fail(400, "Enter a tag name")
  const next = await pool.query(`SELECT COALESCE(MAX(position), 0) + 1 AS position FROM order_tags`)
  try {
    const inserted = await pool.query(
      `INSERT INTO order_tags (name, position) VALUES ($1, $2) RETURNING id, name, position`,
      [name, next.rows[0].position],
    )
    return present(inserted.rows[0])
  } catch (error) {
    if (error.code === "23505") throw fail(400, "A tag with this name already exists")
    throw error
  }
}

export async function updateTag(id, body) {
  const name = cleanName(body.name)
  if (!name) throw fail(400, "Enter a tag name")
  try {
    const updated = await pool.query(
      `UPDATE order_tags SET name = $2 WHERE id = $1 RETURNING id, name, position`,
      [id, name],
    )
    if (!updated.rows[0]) throw fail(404, "Tag was not found")
    return present(updated.rows[0])
  } catch (error) {
    if (error.code === "23505") throw fail(400, "A tag with this name already exists")
    throw error
  }
}

export async function deleteTag(id) {
  const tagId = whole(id)
  if (!tagId) throw fail(400, "Tag is not valid")
  const removed = await pool.query(`DELETE FROM order_tags WHERE id = $1 RETURNING id`, [tagId])
  if (!removed.rows[0]) throw fail(404, "Tag was not found")
}

export function readTagIds(body) {
  if (body.tagIds === undefined) return null
  if (!Array.isArray(body.tagIds)) throw fail(400, "Tags are not valid")
  const ids = [...new Set(body.tagIds.map((item) => whole(item)))]
  if (ids.some((item) => !item || item <= 0)) throw fail(400, "Tags are not valid")
  return ids
}

export async function writeOrderTags(client, orderId, tagIds) {
  if (tagIds === null) return
  if (tagIds.length) {
    const found = await client.query(`SELECT COUNT(*)::int AS count FROM order_tags WHERE id = ANY($1::int[])`, [tagIds])
    if (found.rows[0].count !== tagIds.length) throw fail(400, "A tag was not found. Reload the page.")
  }
  await client.query(`DELETE FROM order_tag_links WHERE order_id = $1`, [orderId])
  if (tagIds.length) {
    await client.query(
      `INSERT INTO order_tag_links (order_id, tag_id) SELECT $1, UNNEST($2::int[])`,
      [orderId, tagIds],
    )
  }
}
