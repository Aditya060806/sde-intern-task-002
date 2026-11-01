import {
  createFileRoute,
  type ErrorComponentProps,
  Link,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useRef, useState } from 'react'
import {
  ApiError,
  api,
  type Balance,
  type Bill,
  errorMessage,
  formatCents,
  parseCents,
  type Share,
} from '../api'

async function loadHome(homeId: string) {
  const [home, { bills }, { balances }] = await Promise.all([
    api.home(homeId),
    api.bills(homeId),
    api.balances(homeId),
  ])
  return { home, bills, balances }
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { home?: string } =>
    typeof search.home === 'string' && search.home ? { home: search.home } : {},
  loaderDeps: ({ search }) => ({ home: search.home }),
  loader: ({ deps }) => (deps.home ? loadHome(deps.home) : null),
  pendingMs: 150,
  pendingComponent: () => (
    <Shell>
      <div className="card skeleton" aria-busy="true">
        Loading home…
      </div>
    </Shell>
  ),
  errorComponent: LoadError,
  component: Page,
})

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="shell">
      <header className="top">
        <Link to="/" search={{}} className="brand">
          Bill Splitter
        </Link>
      </header>
      {children}
    </main>
  )
}

function LoadError({ error }: ErrorComponentProps) {
  const router = useRouter()
  const notFound = error instanceof ApiError && error.status === 404
  return (
    <Shell>
      <div className="card state error" role="alert">
        <h2>{notFound ? 'Home not found' : 'Could not load this home'}</h2>
        <p>{notFound ? 'Check the link or start a new home.' : errorMessage(error)}</p>
        <div className="row">
          {!notFound && (
            <button type="button" onClick={() => router.invalidate()}>
              Try again
            </button>
          )}
          <Link to="/" search={{}} className="button ghost">
            New home
          </Link>
        </div>
      </div>
    </Shell>
  )
}

function useAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (...args: A) => {
    setPending(true)
    setError(null)
    try {
      await fn(...args)
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setPending(false)
    }
  }
  return { run, pending, error, setError }
}

function Page() {
  const data = Route.useLoaderData()
  return <Shell>{data ? <HomeView {...data} /> : <CreateHome />}</Shell>
}

function CreateHome() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const action = useAction(async () => {
    const home = await api.createHome(name)
    await navigate({ to: '/', search: { home: home.id } })
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) action.run()
  }
  return (
    <form className="card stack intro" onSubmit={submit}>
      <h1>Split bills with your home</h1>
      <p className="muted">Create a home, add the people who live there, then add bills.</p>
      <label className="field">
        Home name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Flat 4B"
          maxLength={100}
        />
      </label>
      {action.error && <p className="inline-error">{action.error}</p>}
      <button type="submit" disabled={action.pending || !name.trim()}>
        {action.pending ? 'Creating…' : 'Create home'}
      </button>
    </form>
  )
}

function HomeView({ home, bills, balances }: Awaited<ReturnType<typeof loadHome>>) {
  const names = new Map(balances.map((b) => [b.memberId, b.name]))
  return (
    <>
      <section className="heading">
        <h1>{home.name}</h1>
        <p className="muted">Share this page's link with your housemates.</p>
      </section>
      <div className="grid">
        <aside className="stack">
          <Members balances={balances} homeId={home.id} />
          <AddBill homeId={home.id} disabled={!balances.length} />
        </aside>
        <section className="stack" aria-label="Bills">
          {bills.length ? (
            bills.map((bill) => <BillCard key={bill.id} bill={bill} names={names} />)
          ) : (
            <div className="card state">
              <h2>No bills yet</h2>
              <p className="muted">
                {balances.length
                  ? 'Add the first bill to split it.'
                  : 'Add members, then add a bill.'}
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  )
}

function Members({ balances, homeId }: { balances: Balance[]; homeId: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const action = useAction(async () => {
    await api.addMember(homeId, name)
    setName('')
    await router.invalidate()
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) action.run()
  }
  return (
    <div className="card stack">
      <h2>Members</h2>
      {balances.length ? (
        <ul className="list">
          {balances.map((b) => (
            <li key={b.memberId}>
              <span>{b.name}</span>
              <span className={b.outstandingCents ? 'owes' : 'settled'}>
                {b.outstandingCents ? `owes ${formatCents(b.outstandingCents)}` : 'settled'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No members yet. Bills need at least one.</p>
      )}
      <form className="row" onSubmit={submit}>
        <input
          aria-label="Member name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          maxLength={100}
        />
        <button type="submit" disabled={action.pending || !name.trim()}>
          {action.pending ? 'Adding…' : 'Add'}
        </button>
      </form>
      {action.error && <p className="inline-error">{action.error}</p>}
    </div>
  )
}

function AddBill({ homeId, disabled }: { homeId: string; disabled: boolean }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const cents = parseCents(amount)
  const action = useAction(async (totalCents: number) => {
    await api.addBill(homeId, title, totalCents)
    setTitle('')
    setAmount('')
    await router.invalidate()
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (cents === null) return action.setError('Enter an amount above 0 with at most 2 decimals')
    if (title.trim()) action.run(cents)
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Add a bill</h2>
      <fieldset disabled={disabled || action.pending} className="stack">
        <label className="field">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Electricity"
            maxLength={100}
          />
        </label>
        <label className="field">
          Amount
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="120.50"
            inputMode="decimal"
          />
        </label>
        <button type="submit" disabled={!title.trim() || !amount.trim()}>
          {action.pending ? 'Splitting…' : 'Split bill'}
        </button>
      </fieldset>
      {disabled && <p className="muted">Add a member first.</p>}
      {action.error && <p className="inline-error">{action.error}</p>}
    </form>
  )
}

function BillCard({ bill, names }: { bill: Bill; names: Map<string, string> }) {
  const paid = bill.shares.filter((s) => s.paidAt).length
  return (
    <article className="card">
      <header className="bill-head">
        <h3>{bill.title}</h3>
        <strong>{formatCents(bill.totalCents)}</strong>
      </header>
      <p className="muted small">
        {paid} of {bill.shares.length} paid
      </p>
      <ul className="list">
        {bill.shares.map((share) => (
          <ShareRow
            key={share.id}
            billId={bill.id}
            share={share}
            name={names.get(share.memberId) ?? 'Unknown'}
          />
        ))}
      </ul>
    </article>
  )
}

function ShareRow({ billId, share, name }: { billId: string; share: Share; name: string }) {
  const router = useRouter()
  const key = useRef<string | null>(null)
  const [paidAt, setPaidAt] = useState(share.paidAt)
  const action = useAction(async () => {
    key.current ??= crypto.randomUUID()
    try {
      const result = await api.pay(billId, share.id, key.current)
      setPaidAt(result.paidAt)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) router.invalidate()
      throw err
    }
    router.invalidate()
  })
  const settled = paidAt ?? share.paidAt
  return (
    <li className="share">
      <div className="share-main">
        <span>{name}</span>
        <span className="amount">{formatCents(share.amountCents)}</span>
        {settled ? (
          <span className="badge" title={new Date(settled).toLocaleString()}>
            Paid
          </span>
        ) : (
          <button
            type="button"
            className="small"
            disabled={action.pending}
            onClick={() => action.run()}
          >
            {action.pending ? 'Paying…' : 'Pay'}
          </button>
        )}
      </div>
      {action.error && !settled && (
        <p className="inline-error" role="alert">
          Payment failed: {action.error}
        </p>
      )}
    </li>
  )
}
