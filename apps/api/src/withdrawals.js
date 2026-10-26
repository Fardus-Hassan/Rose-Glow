import { pool } from "./db.js"
import { fail, money, noteText } from "./http.js"
import { dhakaToday } from "./purchases.js"

const DAY = /^\d{4}-\d{2}-\d{2}$/
const REASONS = new Set(["personal", "family", "home", "loan", "savings", "other"])
const IN_RANGE = `($1::date IS NULL OR taken_on >= $1::date) AND ($2::date IS NULL OR taken_on <= $2::date)`

function assertDay(value) {
  const day = String(value || "")
  if (!DAY.test(day)) throw fail(400, "Enter the date")
  if (day > dhakaToday()) throw fail(400, "The date cannot be in the future")
  if (day < "2020-01-01") throw fail(400, "That date is too far back")
  return day
}

function optionalDay(value) {
  const day = String(value || "").trim()
  return day ? assertDay(day) : null
}

function fields(body) {
  const reason = String(body.reason || "")
  const amount = money(body.amount)
  const takenOn = assertDay(body.takenOn)
  const note = noteText(body.note, 160)
  if (!REASONS.has(reason)) throw fail(400, "Choose why you took the money")
  if (amount === null || amount <= 0) throw fail(400, "Enter how much you took")
  return { reason, amount, takenOn, note }
}

export async function withdrawnTotals() {
  const result = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::float8 AS all_time,
            COALESCE(SUM(amount) FILTER (
              WHERE date_trunc('month', taken_on) = date_trunc('month', now() AT TIME ZONE 'Asia/Dhaka')
            ), 0)::float8 AS month,
            COALESCE(SUM(amount) FILTER (WHERE taken_on = (now() AT TIME ZONE 'Asia/Dhaka')::date), 0)::float8 AS today
     FROM owner_withdrawals`,
  )
  const row = result.rows[0]
  return { all: Number(row.all_time), month: Number(row.month), today: Number(row.today) }
}

export async function listWithdrawals({ limit, offset, from, to, reason }) {
  const start = optionalDay(from)
  const end = optionalDay(to)
  if (start && end && start > end) throw fail(400, "The start date is after the end date")
  const only = REASONS.has(String(reason || "")) ? String(reason) : null
  const ofReason = `($3::text IS NULL OR reason = $3::text)`
  const [count, rows, reasons, totals] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total, COALESCE(SUM(amount), 0)::float8 AS amount
       FROM owner_withdrawals WHERE ${IN_RANGE} AND ${ofReason}`,
      [start, end, only],
    ),
    pool.query(
      `SELECT id, taken_on::text AS taken_on, reason, amount::float8 AS amount, note
       FROM owner_withdrawals
       WHERE ${IN_RANGE} AND ${ofReason}
       ORDER BY taken_on DESC, id DESC
       LIMIT $4 OFFSET $5`,
      [start, end, only, limit, offset],
    ),
    pool.query(
      `SELECT reason, COUNT(*)::int AS times, SUM(amount)::float8 AS amount
       FROM owner_withdrawals WHERE ${IN_RANGE}
       GROUP BY reason
       ORDER BY amount DESC`,
      [start, end],
    ),
    withdrawnTotals(),
  ])
  return {
    from: start,
    to: end,
    reason: only,
    withdrawals: rows.rows.map((row) => ({
      id: row.id,
      takenOn: row.taken_on,
      reason: row.reason,
      amount: Number(row.amount),
      note: row.note,
    })),
    total: count.rows[0].total,
    amount: Number(count.rows[0].amount),
    reasons: reasons.rows.map((row) => ({ reason: row.reason, times: row.times, amount: Number(row.amount) })),
    totals,
  }
}

export async function createWithdrawal(body) {
  const { reason, amount, takenOn, note } = fields(body)
  const inserted = await pool.query(
    `INSERT INTO owner_withdrawals (taken_on, reason, amount, note)
     VALUES ($1::date, $2, $3, $4)
     RETURNING id`,
    [takenOn, reason, amount, note],
  )
  return { id: inserted.rows[0].id }
}

export async function updateWithdrawal(id, body) {
  const { reason, amount, takenOn, note } = fields(body)
  const updated = await pool.query(
    `UPDATE owner_withdrawals
     SET taken_on = $2::date, reason = $3, amount = $4, note = $5
     WHERE id = $1
     RETURNING id`,
    [id, takenOn, reason, amount, note],
  )
  if (!updated.rows[0]) throw fail(404, "That withdrawal was not found")
}

export async function deleteWithdrawal(id) {
  const removed = await pool.query(`DELETE FROM owner_withdrawals WHERE id = $1 RETURNING id`, [id])
  if (!removed.rows[0]) throw fail(404, "That withdrawal was not found")
}
