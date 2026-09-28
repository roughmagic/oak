import { Equal, ManagedRuntime } from 'effect'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  CounterModel,
  CounterMsg,
  CounterProgram,
  initialModel,
  update,
} from '../src/counter/index.js'

describe('counter update', () => {
  it('Increment and Decrement change the count and run no commands', () => {
    expect(update(CounterMsg.Increment(), initialModel)).toEqual({
      model: CounterModel({ count: 1 }),
      effects: [],
    })
    expect(update(CounterMsg.Decrement(), initialModel)).toEqual({
      model: CounterModel({ count: -1 }),
      effects: [],
    })
  })

  it('returns a Data.case value, so Equal compares the model by value', () => {
    const { model } = update(CounterMsg.Increment(), initialModel)
    expect(Equal.equals(model, CounterModel({ count: 1 }))).toBe(true)
  })
})

describe('CounterProgram', () => {
  it('stores each model before dispatch returns and tells listeners', () => {
    const runtime = ManagedRuntime.make(CounterProgram.layer)
    onTestFinished(() => runtime.dispose())
    const { state, dispatch } = runtime.runSync(CounterProgram)
    const seen: Array<number> = []
    state.subscribe((model) => seen.push(model.count))

    dispatch(CounterMsg.Increment())
    expect(state.value.count).toBe(1)
    dispatch(CounterMsg.Increment())
    dispatch(CounterMsg.Decrement())
    expect(state.value.count).toBe(1)
    expect(seen).toEqual([1, 2, 1])
  })
})
