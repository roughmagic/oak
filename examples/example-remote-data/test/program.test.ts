import { Effect, Layer, Option, TestClock, TestContext, type Context } from 'effect'
import { describe, expect, it } from 'vitest'
import { ItemApi, ItemFetchError } from '../src/oak-program/item-api.js'
import { ItemMsg } from '../src/oak-program/message.js'
import { getItem, initialModel } from '../src/oak-program/model.js'
import { ItemProgram } from '../src/oak-program/program.js'
import { notRequested, snapshot } from '../src/oak-program/remote-record.js'

// Answers after one second on Effect's Clock, with one outcome per call.
const flaky = (outcomes: ReadonlyArray<'up' | 'down'>) => {
  let calls = 0
  return Layer.succeed(
    ItemApi,
    ItemApi.of({
      fetch: (key) => {
        const call = ++calls
        return Effect.sleep('1 second').pipe(
          Effect.zipRight(
            outcomes[call - 1] === 'down'
              ? Effect.fail(new ItemFetchError({ key, message: 'down' }))
              : Effect.succeed({ value: call }),
          ),
        )
      },
    }),
  )
}

// TestContext goes under the fake and the program, so both keep time on the TestClock.
const runWith =
  (outcomes: ReadonlyArray<'up' | 'down'>) =>
  <A>(test: Effect.Effect<A, never, Context.Tag.Identifier<typeof ItemProgram>>) =>
    test.pipe(
      Effect.provide(ItemProgram.layer),
      Effect.provide(flaky(outcomes)),
      Effect.provide(TestContext.TestContext),
      Effect.runPromise,
    )

describe('item program', () => {
  it('walks a key through loading, loaded, refreshing and errored', () =>
    Effect.gen(function* () {
      const { state, dispatch } = yield* ItemProgram
      const alpha = () => getItem(state.value, 'alpha')
      const data = () => Option.map(snapshot(alpha()), (s) => s.data)

      // dispatch runs update before it returns, so the loading state is visible at once.
      dispatch(ItemMsg.Request({ key: 'alpha' }))
      expect(alpha()._tag).toBe('LoadingInitially')

      yield* TestClock.adjust('1 second')
      expect(alpha()._tag).toBe('Loaded')
      expect(data()).toEqual(Option.some({ value: 1 }))

      dispatch(ItemMsg.Request({ key: 'alpha' }))
      expect(alpha()._tag).toBe('Refreshing')
      expect(data()).toEqual(Option.some({ value: 1 }))

      yield* TestClock.adjust('1 second')
      expect(alpha()._tag).toBe('Errored')
      expect(data()).toEqual(Option.some({ value: 1 }))
    }).pipe(runWith(['up', 'down'])))

  it('starts from init and reads an absent key as the shared NotRequested', () =>
    Effect.gen(function* () {
      const { state } = yield* ItemProgram
      expect(state.value).toBe(initialModel)
      // useSelector compares by Object.is, so an absent key must read as one stable value.
      expect(getItem(state.value, 'nope')).toBe(notRequested)
    }).pipe(runWith([])))
})
