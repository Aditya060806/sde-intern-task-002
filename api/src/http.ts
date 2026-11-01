import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export type App = { Bindings: Env }

export function fail(status: ContentfulStatusCode, message: string): never {
  throw new HTTPException(status, { message })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export async function readBody(req: { json: () => Promise<unknown> }) {
  const body = await req.json().catch(() => fail(400, 'Body must be valid JSON'))
  if (!isRecord(body)) fail(400, 'Body must be a JSON object')
  return body
}

export function text(value: unknown, field: string, max = 100) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) fail(422, `${field} is required`)
  if (trimmed.length > max) fail(422, `${field} must be at most ${max} characters`)
  return trimmed
}

export async function requireHome(db: D1Database, id: string) {
  const home = await db
    .prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(id)
    .first<{ id: string; name: string }>()
  return home ?? fail(404, 'Home not found')
}
