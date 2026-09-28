import { Effect, TestClock, TestContext, type Context, type Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  FakeLedger,
  Toast,
  TransferModel,
  TransferMsg,
  TransferProgram,
  TransferState,
  emptyModel,
  subscriptions,
  update,
  type Ledger,
} from '../src/transfer/index.js'

const model = (fields: Partial<TransferModel>) => TransferModel({ ...emptyModel, ...fields })

const pending = TransferState.Pending({ id: 'transfer-1' })

describe('transfer update', () => {
  it('init asks for the balance', () => {
    const { model: first, effects } = TransferProgram.init
    expect(first).toEqual(model({ balanceRequest: 1, balanceLoading: true }))
    expect(effects).toHaveLength(1)
  })

  it('TransferRequested submits when idle and is ignored while a transfer runs', () => {
    const request = TransferMsg.TransferRequested({ to: 'savings', amount: 30 })
    const submitted = update(request, emptyModel)
    expect(submitted.model.transfer).toEqual(TransferState.Submitting())
    expect(submitted.effects).toHaveLength(1)

    const busy = model({ transfer: pending })
    const ignored = update(request, busy)
    expect(ignored.model).toBe(busy)
    expect(ignored.effects).toEqual([])
  })

  it('Submitted makes the transfer pending under its id', () => {
    const submitting = model({ transfer: TransferState.Submitting() })
    expect(update(TransferMsg.Submitted({ id: 'transfer-1' }), submitting).model.transfer).toEqual(
      pending,
    )
  })

  it('Settled shows a toast and refetches the balance, like BalanceRequested', () => {
    const before = model({ balance: 100, balanceRequest: 3, transfer: pending, nextToastId: 5 })
    const settled = update(TransferMsg.Settled({ id: 'transfer-1' }), before)
    expect(settled.model).toEqual(
      model({
        balance: 100,
        balanceRequest: 4,
        balanceLoading: true,
        transfer: TransferState.Idle(),
        toasts: [Toast({ id: 5, text: 'Transfer settled' })],
        nextToastId: 6,
      }),
    )
    // The toast's expiry and the balance request.
    expect(settled.effects).toHaveLength(2)

    const refresh = update(TransferMsg.BalanceRequested(), before)
    expect(refresh.model).toEqual(model({ ...before, balanceRequest: 4, balanceLoading: true }))
    expect(refresh.effects).toHaveLength(1)
  })

  it('Settled for another transfer changes nothing', () => {
    const before = model({ transfer: pending })
    expect(update(TransferMsg.Settled({ id: 'transfer-0' }), before).model).toBe(before)
    expect(update(TransferMsg.Settled({ id: 'transfer-1' }), emptyModel).model).toBe(emptyModel)
  })

  it('SubmitFailed returns to idle and shows the error in a toast', () => {
    const submitting = model({ transfer: TransferState.Submitting() })
    const failed = update(TransferMsg.SubmitFailed({ error: 'Insufficient funds' }), submitting)
    expect(failed.model).toEqual(
      model({
        toasts: [Toast({ id: 1, text: 'Transfer failed: Insufficient funds' })],
        nextToastId: 2,
      }),
    )
    expect(failed.effects).toHaveLength(1)
  })

  it('BalanceLoaded and BalanceFailed apply only to the latest request', () => {
    const loading = model({ balance: 100, balanceRequest: 2, balanceLoading: true })

    expect(update(TransferMsg.BalanceLoaded({ request: 2, balance: 70 }), loading).model).toEqual(
      model({ balance: 70, balanceRequest: 2 }),
    )
    expect(update(TransferMsg.BalanceLoaded({ request: 1, balance: 100 }), loading).model).toBe(
      loading,
    )

    expect(
      update(TransferMsg.BalanceFailed({ request: 2, error: 'Timeout' }), loading).model,
    ).toEqual(
      model({
        balance: 100,
        balanceRequest: 2,
        toasts: [Toast({ id: 1, text: 'Balance failed: Timeout' })],
        nextToastId: 2,
      }),
    )
    expect(update(TransferMsg.BalanceFailed({ request: 1, error: 'Timeout' }), loading).model).toBe(
      loading,
    )
  })

  it('takes toast ids from the model and removes a toast by its id', () => {
    const fail = (error: string) => TransferMsg.SubmitFailed({ error })
    const two = update(fail('b'), update(fail('a'), emptyModel).model).model
    expect(two.toasts.map((toast) => toast.id)).toEqual([1, 2])

    const dismissed = update(TransferMsg.ToastDismissed({ id: 1 }), two).model
    expect(dismissed.toasts.map((toast) => toast.id)).toEqual([2])
    // The dismissed toast's timer still fires. Its toast is gone, so nothing changes.
    expect(update(TransferMsg.ToastExpired({ id: 1 }), dismissed).model).toBe(dismissed)
    expect(update(TransferMsg.ToastExpired({ id: 2 }), dismissed).model.toasts).toEqual([])
  })
})

describe('transfer subscriptions', () => {
  it('watches only a pending transfer, keyed by its id', () => {
    const keys = (m: TransferModel) => subscriptions(m).map((sub) => sub.key)
    expect(keys(emptyModel)).toEqual([])
    expect(keys(model({ transfer: TransferState.Submitting() }))).toEqual([])
    expect(keys(model({ transfer: pending }))).toEqual(['watch:transfer-1'])
    expect(keys(model({ transfer: pending, balance: 5, nextToastId: 9 }))).toEqual([
      'watch:transfer-1',
    ])
  })
})

// TestContext goes under the fake ledger and the program, so both keep time on the TestClock.
const runWith =
  (ledger: Layer.Layer<Ledger>) =>
  <A>(test: Effect.Effect<A, never, Context.Tag.Identifier<typeof TransferProgram>>) =>
    test.pipe(
      Effect.provide(TransferProgram.layer),
      Effect.provide(ledger),
      Effect.provide(TestContext.TestContext),
      Effect.runPromise,
    )

describe('TransferProgram', () => {
  it('submits, watches until the transfer settles, shows a toast, then refetches the balance', () =>
    Effect.gen(function* () {
      const { state, dispatch } = yield* TransferProgram
      // Fake latencies: submit 500 ms, settle 2 s after submit, balance 300 ms. Polls 1 s apart.
      yield* TestClock.adjust('300 millis') // t = 0.3 s: the init request answers
      expect(state.value).toEqual(model({ balance: 100, balanceRequest: 1 }))

      dispatch(TransferMsg.TransferRequested({ to: 'savings', amount: 30 }))
      expect(state.value.transfer).toEqual(TransferState.Submitting())

      yield* TestClock.adjust('500 millis') // t = 0.8 s: accepted; polls at 0.8, 1.8 and 2.8 s
      expect(state.value.transfer).toEqual(pending)

      yield* TestClock.adjust('2 seconds') // t = 2.8 s: settled, so toast and refetch
      expect(state.value).toEqual(
        model({
          balance: 100,
          balanceRequest: 2,
          balanceLoading: true,
          toasts: [Toast({ id: 1, text: 'Transfer settled' })],
          nextToastId: 2,
        }),
      )

      yield* TestClock.adjust('300 millis') // t = 3.1 s: the refetch answers
      expect(state.value.balance).toBe(70)
      expect(state.value.balanceLoading).toBe(false)

      yield* TestClock.adjust('4 seconds') // t = 7.1 s: the toast has expired
      expect(state.value.toasts).toEqual([])
    }).pipe(runWith(FakeLedger())))

  it('keeps the latest balance when an older, slower response arrives last', () =>
    Effect.gen(function* () {
      const { state, dispatch } = yield* TransferProgram
      // t = 0: the init request reads 100 and takes 3 s.
      dispatch(TransferMsg.TransferRequested({ to: 'savings', amount: 30 }))

      // t = 1.5 s: settled. The refetch reads 70 and takes 1 s.
      yield* TestClock.adjust('2500 millis') // t = 2.5 s: the refetch answers first
      expect(state.value.balance).toBe(70)
      expect(state.value.balanceRequest).toBe(2)

      yield* TestClock.adjust('500 millis') // t = 3 s: the init response arrives, stale
      expect(state.value.balance).toBe(70)
      expect(state.value.balanceLoading).toBe(false)
    }).pipe(
      runWith(FakeLedger({ settleAfter: '1 second', balanceLatencies: ['3 seconds', '1 second'] })),
    ))

  it('shows a toast when the ledger refuses the transfer', () =>
    Effect.gen(function* () {
      const { state, dispatch } = yield* TransferProgram
      dispatch(TransferMsg.TransferRequested({ to: 'savings', amount: 30 }))
      yield* TestClock.adjust('500 millis')
      expect(state.value.transfer).toEqual(TransferState.Idle())
      expect(state.value.toasts).toEqual([
        Toast({ id: 1, text: 'Transfer failed: Insufficient funds' }),
      ])
    }).pipe(runWith(FakeLedger({ balance: 10 }))))
})
