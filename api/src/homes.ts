import { Hono } from 'hono'
import { type App, fail, readBody, requireHome, text } from './http'

export const homes = new Hono<App>()

homes.post('/', async (c) => {
  const name = text((await readBody(c.req)).name, 'name')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

homes.get('/:homeId', async (c) => c.json(await requireHome(c.env.DB, c.req.param('homeId'))))

homes.post('/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const name = text((await readBody(c.req)).name, 'name')
  const id = crypto.randomUUID()
  const { meta } = await c.env.DB.prepare(
    `INSERT INTO members (id, home_id, name, position)
     SELECT ?1, h.id, ?2, (SELECT COALESCE(MAX(position) + 1, 0) FROM members WHERE home_id = h.id)
     FROM homes h WHERE h.id = ?3`,
  )
    .bind(id, name, homeId)
    .run()
  if (!meta.changes) fail(404, 'Home not found')
  return c.json({ id, homeId, name }, 201)
})

homes.get('/:homeId/balances', async (c) => {
  const { id } = await requireHome(c.env.DB, c.req.param('homeId'))
  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS memberId, m.name, COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
     FROM members m LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
     WHERE m.home_id = ? GROUP BY m.id ORDER BY m.position`,
  )
    .bind(id)
    .all<{ memberId: string; name: string; outstandingCents: number }>()
  return c.json({ balances: results })
})
