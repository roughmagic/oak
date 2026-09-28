import { Effect, Layer, TestClock, TestContext } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  JokeFetchError,
  JokeModel,
  JokeMsg,
  JokeProgram,
  JokeService,
  JokeServiceFake,
  initialModel,
  update,
} from '../src/jokes/index.js'

describe('jokes update', () => {
  it('Fetch marks the model pending, clears the error and returns one command', () => {
    const failed = JokeModel({ pending: false, joke: null, error: 'HTTP 503' })
    const { model, effects } = update(JokeMsg.Fetch(), failed)
    expect(model).toEqual(JokeModel({ pending: true, joke: null, error: null }))
    expect(effects).toHaveLength(1)
  })

  it('Got stores the joke', () => {
    const pending = JokeModel({ pending: true, joke: null, error: null })
    expect(update(JokeMsg.Got({ joke: 'Ha' }), pending).model).toEqual(
      JokeModel({ pending: false, joke: 'Ha', error: null }),
    )
  })

  it('Failed keeps the last joke and stores the error', () => {
    const pending = JokeModel({ pending: true, joke: 'Ha', error: null })
    expect(update(JokeMsg.Failed({ error: 'HTTP 503' }), pending).model).toEqual(
      JokeModel({ pending: false, joke: 'Ha', error: 'HTTP 503' }),
    )
  })
})

describe('JokeProgram', () => {
  it('shows the joke from the service after its latency', () =>
    Effect.gen(function* () {
      const { state, dispatch } = yield* JokeProgram
      expect(state.value).toEqual(initialModel)
      dispatch(JokeMsg.Fetch())
      expect(state.value.pending).toBe(true)
      yield* TestClock.adjust('1 second')
      expect(state.value).toEqual(JokeModel({ pending: false, joke: 'A fake joke', error: null }))
    }).pipe(
      Effect.provide(JokeProgram.layer),
      Effect.provide(JokeServiceFake('A fake joke')),
      Effect.provide(TestContext.TestContext),
      Effect.runPromise,
    ))

  it('turns a failed fetch into an error in the model', () =>
    Effect.gen(function* () {
      const { state, dispatch } = yield* JokeProgram
      dispatch(JokeMsg.Fetch())
      yield* TestClock.adjust('1 second')
      expect(state.value).toEqual(JokeModel({ pending: false, joke: null, error: 'HTTP 503' }))
    }).pipe(
      Effect.provide(JokeProgram.layer),
      Effect.provide(
        Layer.succeed(
          JokeService,
          JokeService.of({ fetchJoke: Effect.fail(new JokeFetchError({ message: 'HTTP 503' })) }),
        ),
      ),
      Effect.provide(TestContext.TestContext),
      Effect.runPromise,
    ))
})
