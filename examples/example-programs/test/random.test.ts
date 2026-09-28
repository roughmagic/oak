import { Effect, Layer, Random, TestClock, TestContext } from 'effect'
import { describe, expect, it } from 'vitest'
import { RandomModel, RandomMsg, RandomProgram, initialModel, update } from '../src/random/index.js'

describe('random update', () => {
  it('Fetch marks the model pending and returns one command', () => {
    const { model, commands } = update(RandomMsg.Fetch(), initialModel)
    expect(model).toEqual(RandomModel({ pending: true, value: null }))
    expect(commands).toHaveLength(1)
  })

  it('Set stores the value and clears pending', () => {
    const pending = RandomModel({ pending: true, value: null })
    expect(update(RandomMsg.Set({ value: 7 }), pending)).toEqual({
      model: RandomModel({ pending: false, value: 7 }),
      commands: [],
    })
  })
})

describe('RandomProgram', () => {
  it('sets a number from the Random service two seconds after Fetch', () =>
    Effect.gen(function* () {
      const { state, dispatch } = yield* RandomProgram
      dispatch(RandomMsg.Fetch())
      yield* TestClock.adjust('1999 millis')
      expect(state.value).toEqual(RandomModel({ pending: true, value: null }))
      yield* TestClock.adjust('1 millis')
      expect(state.value).toEqual(RandomModel({ pending: false, value: 42 }))
    }).pipe(
      Effect.provide(RandomProgram.layer),
      // Both go under the program layer, so its commands see the fixed Random and the TestClock.
      Effect.provide(Layer.setRandom(Random.fixed([42]))),
      Effect.provide(TestContext.TestContext),
      Effect.runPromise,
    ))
})
