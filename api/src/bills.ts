import { Hono } from 'hono'
import { type App, fail, readBody, requireHome, text } from './http'

type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }

const SHARE_COLUMNS = 'id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt'

export const split = (totalCents: number, parts: number) => {
  const base = Math.floor(totalCents / parts)
  const extra = totalCents % parts
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0))
}

export const bills = new Hono<App>()

bills.post('/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await readBody(c.req)
  const title = text(body.title, 'title')
  const { totalCents } = body
  if (typeof totalCents !== 'number' || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    fail(422, 'totalCents must be a positive whole number')
  }

  const db = c.env.DB
  const { results } = await db
    .prepare(
      `SELECT m.id FROM homes h LEFT JOIN members m ON m.home_id = h.id
       WHERE h.id = ? ORDER BY m.position`,
    )
    .bind(homeId)
    .all<{ id: string | null }>()
  if (!results.length) fail(404, 'Home not found')
  const memberIds = results.flatMap((row) => (row.id ? [row.id] : []))
  if (!memberIds.length) fail(422, 'Home has no members')

  const id = crypto.randomUUID()
  const amounts = split(totalCents, memberIds.length)
  const shares: Share[] = memberIds.map((memberId, i) => ({
    id: crypto.randomUUID(),
    memberId,
    amountCents: amounts[i] ?? 0,
    paidAt: null,
  }))
  const insertShare = db.prepare(
    'INSERT INTO shares (id, bill_id, home_id, member_id, amount_cents) VALUES (?, ?, ?, ?, ?)',
  )
  await db.batch([
    db
      .prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
      .bind(id, homeId, title, totalCents),
    ...shares.map((s) => insertShare.bind(s.id, id, homeId, s.memberId, s.amountCents)),
  ])
  return c.json({ id, homeId, title, totalCents, shares }, 201)
})

bills.get('/homes/:homeId/bills', async (c) => {
  const { id: homeId } = await requireHome(c.env.DB, c.req.param('homeId'))
  const { results } = await c.env.DB.prepare(
    `SELECT b.id AS billId, b.title, b.total_cents AS totalCents, s.id, s.member_id AS memberId,
       s.amount_cents AS amountCents, s.paid_at AS paidAt
     FROM bills b JOIN shares s ON s.bill_id = b.id JOIN members m ON m.id = s.member_id
     WHERE b.home_id = ? ORDER BY b.created_at DESC, b.rowid DESC, m.position`,
  )
    .bind(homeId)
    .all<Share & { billId: string; title: string; totalCents: number }>()

  const byId = new Map<
    string,
    { id: string; homeId: string; title: string; totalCents: number; shares: Share[] }
  >()
  for (const { billId, title, totalCents, ...share } of results) {
    const bill = byId.get(billId) ?? { id: billId, homeId, title, totalCents, shares: [] }
    bill.shares.push(share)
    byId.set(billId, bill)
  }
  return c.json({ bills: [...byId.values()] })
})

bills.post('/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) fail(400, 'Idempotency-Key header is required')
  if (key.length > 200) fail(400, 'Idempotency-Key must be at most 200 characters')
  const { billId, shareId } = c.req.param()
  const db = c.env.DB

  const paid = await db
    .prepare(
      `UPDATE shares SET paid_at = ?, idempotency_key = ?
       WHERE id = ? AND bill_id = ? AND paid_at IS NULL RETURNING ${SHARE_COLUMNS}`,
    )
    .bind(new Date().toISOString(), key, shareId, billId)
    .first<Share>()
  if (paid) return c.json(paid)

  const found = await db
    .prepare(
      `SELECT s.id, s.member_id AS memberId, s.amount_cents AS amountCents, s.paid_at AS paidAt,
         s.idempotency_key AS key
       FROM bills b LEFT JOIN shares s ON s.bill_id = b.id AND s.id = ? WHERE b.id = ?`,
    )
    .bind(shareId, billId)
    .first<{ [K in keyof Share]: Share[K] | null } & { key: string | null }>()
  if (!found) fail(404, 'Bill not found')
  const { key: usedKey, id, memberId, amountCents, paidAt } = found
  if (!id) fail(404, 'Share not found')
  if (usedKey !== key) fail(409, 'Share is already paid')
  return c.json({ id, memberId, amountCents, paidAt })
})
