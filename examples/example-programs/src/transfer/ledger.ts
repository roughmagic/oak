import { Clock, Context, Data, Duration, Effect, Layer } from 'effect'
import type { NonEmptyReadonlyArray } from 'effect/Array'

export type TransferId = string

export type TransferStatus = 'pending' | 'settled'

export class LedgerError extends Data.TaggedError('LedgerError')<{
  readonly message: string
}> {}

/** A remote ledger. A transfer it accepts settles some time later. */
export interface Ledger {
  readonly submit: (transfer: {
    readonly to: string
    readonly amount: number
  }) => Effect.Effect<TransferId, LedgerError>
  readonly status: (id: TransferId) => Effect.Effect<TransferStatus, LedgerError>
  readonly balance: Effect.Effect<number, LedgerError>
}

export const Ledger = Context.GenericTag<Ledger>('@roughmagic/example-programs/Ledger')

export interface FakeLedgerOptions {
  /** The balance before any transfer. */
  readonly balance?: number
  /** How long `submit` takes to answer. */
  readonly submitLatency?: Duration.DurationInput
  /** How long a transfer takes to settle after `submit` accepts it. */
  readonly settleAfter?: Duration.DurationInput
  /** How long each `balance` call takes, in call order. The last latency repeats. */
  readonly balanceLatencies?: NonEmptyReadonlyArray<Duration.DurationInput>
}

interface Entry {
  readonly id: TransferId
  readonly amount: number
  readonly settlesAt: number
}

const defaults = {
  balance: 100,
  submitLatency: '500 millis',
  settleAfter: '2 seconds',
  balanceLatencies: ['300 millis'],
} satisfies Required<FakeLedgerOptions>

/**
 * An in-memory ledger with fixed latencies. It keeps time with Effect's Clock, so under
 * `TestContext` the TestClock drives it.
 */
export const FakeLedger = (options: FakeLedgerOptions = {}): Layer.Layer<Ledger> =>
  Layer.sync(Ledger, () => {
    const { balance, submitLatency, settleAfter, balanceLatencies } = { ...defaults, ...options }
    // Plain mutable state is safe here: no `yield*` separates a read from the write that
    // depends on it, so no other fiber can run in between.
    const entries: Array<Entry> = []
    let balanceCalls = 0

    // A transfer counts once it has settled at `time`.
    const balanceAt = (time: number) =>
      entries.reduce((sum, t) => (t.settlesAt <= time ? sum - t.amount : sum), balance)

    return Ledger.of({
      submit: ({ amount }) =>
        Effect.gen(function* () {
          yield* Effect.sleep(submitLatency)
          const now = yield* Clock.currentTimeMillis
          // Pending transfers hold their funds too.
          if (amount > balanceAt(Infinity)) {
            return yield* new LedgerError({ message: 'Insufficient funds' })
          }
          const id = `transfer-${entries.length + 1}`
          entries.push({ id, amount, settlesAt: now + Duration.toMillis(settleAfter) })
          return id
        }),

      status: (id) =>
        Effect.gen(function* () {
          const transfer = entries.find((t) => t.id === id)
          if (transfer === undefined) {
            return yield* new LedgerError({ message: `Unknown transfer ${id}` })
          }
          const now = yield* Clock.currentTimeMillis
          return now >= transfer.settlesAt ? ('settled' as const) : ('pending' as const)
        }),

      // The ledger reads the balance when the call arrives and answers after the latency. A slow
      // call can therefore answer with an older balance after a faster, later call.
      balance: Effect.gen(function* () {
        const latency = balanceLatencies[Math.min(balanceCalls, balanceLatencies.length - 1)]
        balanceCalls += 1
        const amount = balanceAt(yield* Clock.currentTimeMillis)
        yield* Effect.sleep(latency)
        return amount
      }),
    })
  })
