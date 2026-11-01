export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Home = { id: string; name: string }
export type Member = { id: string; homeId: string; name: string }
export type Balance = { memberId: string; name: string; outstandingCents: number }

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const TIMEOUT_MS = 8000

async function request<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError'
    throw new ApiError(
      timedOut ? 'The server took too long to answer' : 'Could not reach the server',
      0,
    )
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed (${res.status})`
    throw new ApiError(message, res.status)
  }
  return body as T
}

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'Something went wrong'

export const api = {
  createHome: (name: string) => request<Home>('/homes', { method: 'POST', body: { name } }),
  home: (id: string) => request<Home>(`/homes/${encodeURIComponent(id)}`),
  addMember: (homeId: string, name: string) =>
    request<Member>(`/homes/${encodeURIComponent(homeId)}/members`, {
      method: 'POST',
      body: { name },
    }),
  bills: (homeId: string) =>
    request<{ bills: Bill[] }>(`/homes/${encodeURIComponent(homeId)}/bills`),
  balances: (homeId: string) =>
    request<{ balances: Balance[] }>(`/homes/${encodeURIComponent(homeId)}/balances`),
  addBill: (homeId: string, title: string, totalCents: number) =>
    request<Bill>(`/homes/${encodeURIComponent(homeId)}/bills`, {
      method: 'POST',
      body: { title, totalCents },
    }),
  pay: (billId: string, shareId: string, key: string) =>
    request<Share>(
      `/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
      },
    ),
}

export const formatCents = (cents: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100)

export function parseCents(input: string) {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return cents > 0 ? cents : null
}
