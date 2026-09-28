import { describe, expect, it, vi } from 'vitest'
import { makeKernel } from '../src/kernel.js'
import { thrownBy } from './helpers.js'

interface Model {
  readonly count: number
}

type Msg =
  | { readonly _tag: 'Inc' }
  | { readonly _tag: 'Set'; readonly value: number }
  | { readonly _tag: 'Same' }
  | { readonly _tag: 'Throw' }
  | { readonly _tag: 'Fx'; readonly commands: ReadonlyArray<string> }

const boom = new Error('boom from update')

const update = (msg: Msg, model: Model) => {
  switch (msg._tag) {
    case 'Inc':
      return { model: { count: model.count + 1 }, commands: [] }
    case 'Set':
      return { model: { count: msg.value }, commands: [] }
    case 'Same':
      return { model, commands: [] }
    case 'Throw':
      throw boom
    case 'Fx':
      return { model: { count: model.count + 1 }, commands: msg.commands }
  }
}

const setup = (count = 0) => {
  const ran: string[] = []
  const reportListener = vi.fn<(error: unknown) => void>()
  const kernel = makeKernel<Model, Msg, string>(
    { count },
    update,
    (cmd) => ran.push(cmd),
    reportListener,
  )
  return { kernel, ran, reportListener }
}

describe('makeKernel', () => {
  it('reads the init model before any dispatch', () => {
    const { kernel } = setup(7)
    expect(kernel.state.value).toEqual({ count: 7 })
  })

  it('stores the next model before dispatch returns', () => {
    const { kernel } = setup()
    kernel.dispatch({ _tag: 'Inc' })
    expect(kernel.state.value).toEqual({ count: 1 })
    kernel.dispatch({ _tag: 'Inc' })
    kernel.dispatch({ _tag: 'Inc' })
    expect(kernel.state.value).toEqual({ count: 3 })
  })

  it('notifies listeners with each new model', () => {
    const { kernel } = setup()
    const seen: Model[] = []
    kernel.state.subscribe((m) => seen.push(m))
    kernel.dispatch({ _tag: 'Inc' })
    kernel.dispatch({ _tag: 'Set', value: 10 })
    expect(seen).toEqual([{ count: 1 }, { count: 10 }])
  })

  it('notifies nobody when update returns the same model', () => {
    const { kernel } = setup()
    const listener = vi.fn()
    kernel.state.subscribe(listener)
    kernel.dispatch({ _tag: 'Same' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying a listener after it unsubscribes', () => {
    const { kernel } = setup()
    const listener = vi.fn()
    const unsubscribe = kernel.state.subscribe(listener)
    kernel.dispatch({ _tag: 'Inc' })
    unsubscribe()
    kernel.dispatch({ _tag: 'Inc' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps each subscribe call separate when one function subscribes twice', () => {
    const { kernel } = setup()
    const seen: number[] = []
    const listener = (m: Model) => seen.push(m.count)
    const unsubscribeFirst = kernel.state.subscribe(listener)
    kernel.state.subscribe(listener)
    kernel.dispatch({ _tag: 'Inc' })
    unsubscribeFirst()
    kernel.dispatch({ _tag: 'Inc' })
    expect(seen).toEqual([1, 1, 2])
  })

  it('notifies a snapshot: a change to the listener set applies from the next dispatch', () => {
    const { kernel } = setup()
    const seen: string[] = []
    let unsubscribeSecond = () => {}
    let changed = false
    kernel.state.subscribe((m) => {
      seen.push(`first:${m.count}`)
      if (!changed) {
        changed = true
        unsubscribeSecond()
        kernel.state.subscribe((m) => seen.push(`third:${m.count}`))
      }
    })
    unsubscribeSecond = kernel.state.subscribe((m) => seen.push(`second:${m.count}`))
    kernel.dispatch({ _tag: 'Inc' })
    expect(seen).toEqual(['first:1', 'second:1'])
    kernel.dispatch({ _tag: 'Inc' })
    expect(seen).toEqual(['first:1', 'second:1', 'first:2', 'third:2'])
  })

  it('reports a throwing listener and still runs the others', () => {
    const { kernel, reportListener } = setup()
    const good = vi.fn()
    const error = new Error('listener exploded')
    kernel.state.subscribe(() => {
      throw error
    })
    kernel.state.subscribe(good)
    kernel.dispatch({ _tag: 'Inc' })
    expect(good).toHaveBeenCalledWith({ count: 1 })
    expect(reportListener.mock.calls).toEqual([[error]])
  })

  it('rethrows a throwing update and changes nothing, like a Redux reducer', () => {
    const { kernel, ran, reportListener } = setup()
    const listener = vi.fn()
    kernel.state.subscribe(listener)
    expect(thrownBy(() => kernel.dispatch({ _tag: 'Throw' }))).toBe(boom)
    expect(kernel.state.value).toEqual({ count: 0 })
    expect(listener).not.toHaveBeenCalled()
    expect(ran).toEqual([])
    expect(reportListener).not.toHaveBeenCalled()
    kernel.dispatch({ _tag: 'Inc' })
    expect(kernel.state.value).toEqual({ count: 1 })
  })

  it('hands each command to run in order, after the listeners', () => {
    const { kernel, ran } = setup()
    kernel.state.subscribe(() => ran.push('listener'))
    kernel.dispatch({ _tag: 'Fx', commands: ['a', 'b'] })
    expect(ran).toEqual(['listener', 'a', 'b'])
  })

  describe('re-entrant dispatch', () => {
    it('throws inside update, and the throw comes out of the outer dispatch', () => {
      const reportListener = vi.fn()
      const kernel = makeKernel<Model, Msg, never>(
        { count: 0 },
        (msg, model) => {
          if (msg._tag === 'Inc') kernel.dispatch({ _tag: 'Set', value: 99 })
          return { model: { count: model.count + 1 }, commands: [] }
        },
        () => {},
        reportListener,
      )
      expect(() => kernel.dispatch({ _tag: 'Inc' })).toThrow('may not dispatch')
      expect(kernel.state.value).toEqual({ count: 0 })
      expect(reportListener).not.toHaveBeenCalled()
      kernel.dispatch({ _tag: 'Set', value: 5 })
      expect(kernel.state.value).toEqual({ count: 1 })
    })

    it('throws inside a listener, which reports it while the other listeners run', () => {
      const { kernel, reportListener } = setup()
      const seen: number[] = []
      kernel.state.subscribe(() => kernel.dispatch({ _tag: 'Inc' }))
      kernel.state.subscribe((m) => seen.push(m.count))
      kernel.dispatch({ _tag: 'Inc' })
      expect(kernel.state.value).toEqual({ count: 1 })
      expect(seen).toEqual([1])
      expect(reportListener).toHaveBeenCalledTimes(1)
      expect(String(reportListener.mock.calls[0]?.[0])).toContain('may not dispatch')
    })
  })

  it('does nothing on dispatch after close', () => {
    const { kernel } = setup()
    kernel.dispatch({ _tag: 'Inc' })
    expect(kernel.open).toBe(true)
    kernel.close()
    expect(kernel.open).toBe(false)
    kernel.dispatch({ _tag: 'Inc' })
    expect(kernel.state.value).toEqual({ count: 1 })
  })
})
