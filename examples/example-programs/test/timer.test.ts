import { Effect, TestClock, TestContext } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  TimerModel,
  TimerMsg,
  TimerProgram,
  initialModel,
  subscriptions,
  update,
} from '../src/timer/index.js'

describe('timer update', () => {
  it('Tick counts, Reset clears the count and SetInterval stores the interval', () => {
    const model = TimerModel({ ticks: 4, intervalMs: 1000 })
    expect(update(TimerMsg.Tick(), model).model).toEqual(TimerModel({ ticks: 5, intervalMs: 1000 }))
    expect(update(TimerMsg.Reset(), model).model).toEqual(
      TimerModel({ ticks: 0, intervalMs: 1000 }),
    )
    expect(update(TimerMsg.SetInterval({ ms: 250 }), model).model).toEqual(
      TimerModel({ ticks: 4, intervalMs: 250 }),
    )
  })
})

describe('timer subscriptions', () => {
  it('keys the ticker by its interval and nothing else', () => {
    const keys = (model: TimerModel) => subscriptions(model).map((sub) => sub.key)
    expect(keys(initialModel)).toEqual(['tick:1000'])
    expect(keys(TimerModel({ ticks: 9, intervalMs: 1000 }))).toEqual(['tick:1000'])
    expect(keys(TimerModel({ ticks: 0, intervalMs: 250 }))).toEqual(['tick:250'])
  })
})

describe('TimerProgram', () => {
  it('ticks once per interval and restarts the ticker when the interval changes', () =>
    Effect.gen(function* () {
      const { state, dispatch } = yield* TimerProgram
      yield* TestClock.adjust('3 seconds')
      expect(state.value.ticks).toBe(3)

      // The old ticker was due at 4 s. The new one starts now and ticks at 3.5 s and 4 s.
      dispatch(TimerMsg.SetInterval({ ms: 500 }))
      yield* TestClock.adjust('1 second')
      expect(state.value.ticks).toBe(5)

      dispatch(TimerMsg.Reset())
      expect(state.value.ticks).toBe(0)
    }).pipe(
      Effect.provide(TimerProgram.layer),
      Effect.provide(TestContext.TestContext),
      Effect.runPromise,
    ))
})
