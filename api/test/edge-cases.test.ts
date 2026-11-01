import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, createBill, createHome, type Share } from './helpers'

const pay = (billId: string, shareId: string, key: string) =>
  call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': key },
  })

describe('edge cases', () => {
  it('lets only one of many concurrent payments win', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const { body } = await createBill(homeId, 1000)
    const share = body.shares[0]
    if (!share) throw new Error('no share')

    const results = await Promise.all(
      Array.from({ length: 10 }, () => pay(body.id, share.id, crypto.randomUUID())),
    )

    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(9)
  })

  it('answers concurrent retries with the same key identically', async () => {
    const { homeId } = await createHome(['Asha'])
    const { body } = await createBill(homeId, 700)
    const share = body.shares[0]
    if (!share) throw new Error('no share')
    const key = crypto.randomUUID()

    const results = await Promise.all(Array.from({ length: 5 }, () => pay(body.id, share.id, key)))

    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(new Set(results.map((r) => r.body.paidAt)).size).toBe(1)
  })

  it('does not pay a share through another bill', async () => {
    const { homeId } = await createHome(['Asha'])
    const first = await createBill(homeId, 100)
    const second = await createBill(homeId, 200)
    const share = second.body.shares[0]
    if (!share) throw new Error('no share')

    expect((await pay(first.body.id, share.id, crypto.randomUUID())).status).toBe(404)
  })

  it('gives zero shares when the total is smaller than the member count', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])

    const bill = await createBill(homeId, 1)

    expect(bill.body.shares.map((s) => s.amountCents)).toEqual([1, 0, 0])
  })

  it('rejects a blank Idempotency-Key', async () => {
    const { homeId } = await createHome(['Asha'])
    const { body } = await createBill(homeId, 100)

    expect((await pay(body.id, body.shares[0]?.id ?? '', '   ')).status).toBe(400)
  })

  it.each([{}, { name: '' }, { name: '   ' }, { name: 42 }])(
    'rejects the home %j',
    async (body) => {
      const home = await call<{ error: string }>('POST', '/api/homes', { body })

      expect(home.status).toBe(422)
      expect(home.body.error).toEqual(expect.any(String))
    },
  )

  it('rejects a bill without a title', async () => {
    const { homeId } = await createHome(['Asha'])

    const bill = await call('POST', `/api/homes/${homeId}/bills`, { body: { totalCents: 100 } })

    expect(bill.status).toBe(422)
  })

  it('answers malformed JSON with a JSON error', async () => {
    const response = await exports.default.fetch(
      new Request('http://localhost/api/homes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"name":',
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: expect.any(String) })
  })

  it('answers unknown routes with a JSON error', async () => {
    const response = await call('GET', '/api/nope')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: expect.any(String) })
  })

  it('lists bills newest first with shares in member order', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben'])
    await createBill(homeId, 101)
    const latest = await createBill(homeId, 301)

    const listed = await call<{ bills: { id: string; shares: Share[] }[] }>(
      'GET',
      `/api/homes/${homeId}/bills`,
    )

    expect(listed.body.bills.map((b) => b.id)[0]).toBe(latest.body.id)
    expect(listed.body.bills[0]?.shares.map((s) => s.memberId)).toEqual(members.map((m) => m.id))
    expect(listed.body.bills[0]?.shares.map((s) => s.amountCents)).toEqual([151, 150])
  })
})
