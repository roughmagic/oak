import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { Component, useLayoutEffect, type ReactNode } from 'react'
import { onTestFinished } from 'vitest'
import { makeProgram, type Command, type Update } from '@roughmagic/oak'
import { OakProvider, createOakHooks } from '../src/index.js'

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A runtime for one test. It is disposed when the test finishes. */
export const testRuntime = <R, E>(layer: Layer.Layer<R, E>) => {
  const runtime = ManagedRuntime.make(layer)
  onTestFinished(() => runtime.dispose())
  return runtime
}

/** A layer that counts its builds and disposals. Merge it beside a program's layer. */
export const counting = () => {
  const stats = { builds: 0, disposals: 0 }
  const layer = Layer.scopedDiscard(
    Effect.acquireRelease(
      Effect.sync(() => {
        stats.builds++
      }),
      () =>
        Effect.sync(() => {
          stats.disposals++
        }),
    ),
  )
  return { stats, layer }
}

export interface Model {
  readonly count: number
  readonly label: string
}

export type Msg =
  | { readonly _tag: 'Inc' }
  | { readonly _tag: 'SetLabel'; readonly label: string }
  | { readonly _tag: 'Copy' }

export const inc: Msg = { _tag: 'Inc' }

export const update: Update<Model, Msg> = (msg, model) => {
  switch (msg._tag) {
    case 'Inc':
      return { model: { ...model, count: model.count + 1 }, effects: [] }
    case 'SetLabel':
      return { model: { ...model, label: msg.label }, effects: [] }
    case 'Copy':
      // A new model with the same values.
      return { model: { ...model }, effects: [] }
  }
}

export const makeCounter = (count = 0, effects: ReadonlyArray<Command<Msg>> = []) =>
  makeProgram('test/Counter', { init: { model: { count, label: 'a' }, effects }, update })

/** A counter whose layer counts its builds and disposals. */
export const makeCounted = (count = 0, effects: ReadonlyArray<Command<Msg>> = []) => {
  const program = makeCounter(count, effects)
  const { stats, layer } = counting()
  return { program, stats, layer: Layer.merge(program.layer, layer) }
}

export type Counted = ReturnType<typeof makeCounted>

export const { useSelector, useDispatch } = createOakHooks<Model, Msg>()

export function Count() {
  const count = useSelector((m) => m.count)
  const dispatch = useDispatch()
  return <button onClick={() => dispatch(inc)}>{count}</button>
}

/** Dispatches `inc` from a layout effect when it mounts. */
export function IncOnMount() {
  const dispatch = useDispatch()
  useLayoutEffect(() => {
    dispatch(inc)
  }, [dispatch])
  return null
}

export class Boundary extends Component<
  { readonly children: ReactNode },
  { readonly error?: Error }
> {
  override state: { readonly error?: Error } = {}
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  override render() {
    return this.state.error === undefined ? this.props.children : <p>caught</p>
  }
}

type Tick = { readonly _tag: 'Tick' }

/** A program that ticks every 5 ms, with a layer that counts its builds and disposals. */
export const makeTicker = () => {
  const counted = counting()
  const stats = Object.assign(counted.stats, { updates: 0 })
  const program = makeProgram('test/Ticker', {
    init: { model: 0, effects: [] },
    update: (_msg: Tick, ticks: number) => {
      stats.updates++
      return { model: ticks + 1, effects: [] }
    },
    subscriptions: () => [
      { key: 'tick', stream: Stream.tick('5 millis').pipe(Stream.as<Tick>({ _tag: 'Tick' })) },
    ],
  })
  return { program, layer: Layer.merge(program.layer, counted.layer), stats }
}

type Ticker = ReturnType<typeof makeTicker>

const tickerHooks = createOakHooks<number, Tick>()

export function Ticks() {
  const ticking = tickerHooks.useSelector((ticks) => ticks > 0)
  return <output>{ticking ? 'ticking' : 'idle'}</output>
}

/** The ticker on a runtime that the provider owns for one mount. */
export function TickerApp({ ticker }: { readonly ticker: Ticker }) {
  return (
    <OakProvider program={ticker.program} layer={ticker.layer}>
      <Ticks />
    </OakProvider>
  )
}
