import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context, Deferred, Effect, Exit, Layer, Runtime, Scope } from 'effect'
import { Activity, StrictMode, Suspense, createElement, use, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeProgram, type Command } from '@roughmagic/oak'
import { OakProvider, createOakHooks } from '../src/index.js'
import {
  Count,
  IncOnMount,
  TickerApp,
  Ticks,
  inc,
  makeCounted,
  makeCounter,
  makeTicker,
  sleep,
  testRuntime,
  update,
  useDispatch,
  useSelector,
  type Counted,
  type Model,
  type Msg,
} from './programs.js'

afterEach(async () => {
  cleanup()
  // Lets disposals that unmounting started finish inside the test that caused them.
  await sleep(0)
  vi.restoreAllMocks()
})

type Mode = 'runtime' | 'layer'
const modes: ReadonlyArray<Mode> = ['runtime', 'layer']

/** The counter under a provider that gets a runtime the app owns, or a layer to own. */
const provide = (mode: Mode, counted: Counted, children: ReactNode) =>
  mode === 'runtime' ? (
    <OakProvider program={counted.program} runtime={testRuntime(counted.layer)}>
      {children}
    </OakProvider>
  ) : (
    <OakProvider program={counted.program} layer={counted.layer}>
      {children}
    </OakProvider>
  )

const button = () => screen.getByRole('button').textContent

describe('OakProvider', () => {
  it('shows the init model on the first render and dispatches synchronously', () => {
    const program = makeCounter(7)
    const runtime = testRuntime(program.layer)
    const seen: Array<number> = []
    function Seen() {
      seen.push(useSelector((m) => m.count))
      return null
    }

    render(
      <OakProvider runtime={runtime} program={program}>
        <Seen />
        <Count />
      </OakProvider>,
    )
    expect(seen[0]).toBe(7)
    expect(button()).toBe('7')

    fireEvent.click(screen.getByRole('button'))
    expect(button()).toBe('8')
  })

  it.each(modes)(
    'starts the program in the commit phase, and the view catches up with init commands (%s)',
    (mode) => {
      const counted = makeCounted(0, [Effect.succeed(inc)])
      const seen: Array<readonly [number, number]> = []
      function Seen() {
        seen.push([useSelector((m) => m.count), counted.stats.builds])
        return null
      }

      render(
        provide(
          mode,
          counted,
          <>
            <Seen />
            <Count />
          </>,
        ),
      )
      expect(seen[0]).toEqual([0, 0])
      expect(counted.stats.builds).toBe(1)
      expect(button()).toBe('1')
    },
  )

  it("shows a command's message once the command completes", async () => {
    interface Numbers {
      readonly next: Effect.Effect<number>
    }
    const Numbers = Context.GenericTag<Numbers>('test/Numbers')
    type LoaderMsg = { readonly _tag: 'Load' } | { readonly _tag: 'Loaded'; readonly value: number }

    const load: Command<LoaderMsg, Numbers> = Effect.gen(function* () {
      const numbers = yield* Numbers
      const value = yield* numbers.next
      return { _tag: 'Loaded' as const, value }
    })
    const program = makeProgram('test/Loader', {
      init: { model: 'idle', effects: [] },
      update: (msg: LoaderMsg) =>
        msg._tag === 'Load'
          ? { model: 'loading', effects: [load] }
          : { model: String(msg.value), effects: [] },
    })
    const numbers = Layer.succeed(Numbers, { next: Effect.delay(Effect.succeed(42), '5 millis') })
    const runtime = testRuntime(program.layer.pipe(Layer.provide(numbers)))
    const { useSelector, useDispatch } = createOakHooks<string, LoaderMsg>()
    function Loader() {
      const text = useSelector((m) => m)
      const dispatch = useDispatch()
      return <button onClick={() => dispatch({ _tag: 'Load' })}>{text}</button>
    }

    render(
      <OakProvider runtime={runtime} program={program}>
        <Loader />
      </OakProvider>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(button()).toBe('loading')
    expect(await screen.findByText('42')).toBeTruthy()
  })

  it.each(modes)('starts the program before any layout effect below the provider (%s)', (mode) => {
    render(
      provide(
        mode,
        makeCounted(),
        <div>
          <div>
            <IncOnMount />
          </div>
          <Count />
        </div>,
      ),
    )
    expect(button()).toBe('1')
  })

  it('shows the live model on the first render of a remount', () => {
    const program = makeCounter()
    const runtime = testRuntime(program.layer)
    const app = (
      <OakProvider runtime={runtime} program={program}>
        <Count />
      </OakProvider>
    )
    const first = render(app)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    first.unmount()

    const seen: Array<number> = []
    function Seen() {
      seen.push(useSelector((m) => m.count))
      return null
    }
    render(
      <OakProvider runtime={runtime} program={program}>
        <Seen />
      </OakProvider>,
    )
    expect(seen).toEqual([3])
  })

  it('makes the hooks throw a clear error outside an OakProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Dispatcher() {
      useDispatch()
      return null
    }
    const message = 'Oak: useSelector and useDispatch must be called inside an <OakProvider>.'
    expect(() => render(<Count />)).toThrow(message)
    expect(() => render(<Dispatcher />)).toThrow(message)
  })

  it('returns the same dispatch on every render', () => {
    const program = makeCounter()
    const runtime = testRuntime(program.layer)
    const seen = new Set<unknown>()
    function Seen() {
      useSelector((m) => m.count)
      seen.add(useDispatch())
      return null
    }
    render(
      <OakProvider runtime={runtime} program={program}>
        <Seen />
        <Count />
      </OakProvider>,
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    expect(seen.size).toBe(1)
  })

  it('returns the same dispatch when a provider with a layer starts its program again', async () => {
    const counted = makeCounted()
    const seen = new Set<unknown>()
    function Seen() {
      useSelector((m) => m.count)
      seen.add(useDispatch())
      return null
    }
    const app = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <OakProvider program={counted.program} layer={counted.layer}>
          <Seen />
          <Count />
        </OakProvider>
      </Activity>
    )
    const { rerender } = render(app('visible'))
    await act(async () => {
      rerender(app('hidden'))
      await sleep(5)
    })
    await act(async () => rerender(app('visible')))
    // Hiding stopped the first program, and showing started a second one.
    expect(counted.stats).toEqual({ builds: 2, disposals: 1 })
    fireEvent.click(screen.getByRole('button'))
    expect(button()).toBe('1')
    expect(seen.size).toBe(1)
  })

  it('rethrows an update error from dispatch, and the view keeps its model', () => {
    type Fragile = Msg | { readonly _tag: 'Boom' }
    const boom = new Error('update failed')
    const program = makeProgram('test/Fragile', {
      init: { model: { count: 0, label: 'a' }, effects: [] },
      update: (msg: Fragile, model: Model) => {
        if (msg._tag === 'Boom') {
          throw boom
        }
        return update(msg, model)
      },
    })
    const hooks = createOakHooks<Model, Fragile>()
    let dispatch: (msg: Fragile) => void = () => {}
    function View() {
      const count = hooks.useSelector((m) => m.count)
      dispatch = hooks.useDispatch()
      return <button onClick={() => dispatch(inc)}>{count}</button>
    }
    render(
      <OakProvider program={program} layer={program.layer}>
        <View />
      </OakProvider>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(button()).toBe('1')

    let thrown: unknown
    act(() => {
      try {
        dispatch({ _tag: 'Boom' })
      } catch (error) {
        thrown = error
      }
    })
    expect(thrown).toBe(boom)
    expect(button()).toBe('1')
    fireEvent.click(screen.getByRole('button'))
    expect(button()).toBe('2')
  })
})

describe('OakProvider with a sibling that suspends', () => {
  const suspendOnce = () => {
    const ready = sleep(10)
    return function SuspendOnce() {
      use(ready)
      return null
    }
  }

  it.each([
    ['plain', false],
    ['StrictMode', true],
  ])('layer: builds once (%s), and stops the program on unmount', async (_mode, strict) => {
    const ticker = makeTicker()
    const SuspendOnce = suspendOnce()
    const app = (
      <Suspense fallback={<p>loading</p>}>
        <SuspendOnce />
        <TickerApp ticker={ticker} />
      </Suspense>
    )

    const { unmount } = await act(async () => render(strict ? <StrictMode>{app}</StrictMode> : app))
    expect(await screen.findByText('ticking')).toBeTruthy()
    expect(ticker.stats.builds).toBe(1)

    unmount()
    await sleep(20)
    expect(ticker.stats.disposals).toBe(1)
    const updates = ticker.stats.updates
    await sleep(30)
    expect(ticker.stats.updates).toBe(updates)
  })

  it.each([
    ['plain', false],
    ['StrictMode', true],
  ])('runtime: builds once (%s), and unmount stops nothing', async (_mode, strict) => {
    const ticker = makeTicker()
    const runtime = testRuntime(ticker.layer)
    const SuspendOnce = suspendOnce()
    const app = (
      <Suspense fallback={<p>loading</p>}>
        <SuspendOnce />
        <OakProvider program={ticker.program} runtime={runtime}>
          <Ticks />
        </OakProvider>
      </Suspense>
    )

    const { unmount } = await act(async () => render(strict ? <StrictMode>{app}</StrictMode> : app))
    expect(await screen.findByText('ticking')).toBeTruthy()
    expect(ticker.stats.builds).toBe(1)

    unmount()
    const updates = ticker.stats.updates
    await sleep(30)
    expect(ticker.stats.updates).toBeGreaterThan(updates)
    expect(ticker.stats.disposals).toBe(0)
  })
})

describe('OakProvider with a runtime', () => {
  it('builds once under StrictMode, and the replayed layout effect reaches the same program', async () => {
    const counted = makeCounted()
    const runtime = testRuntime(counted.layer)
    await act(async () =>
      render(
        <StrictMode>
          <OakProvider program={counted.program} runtime={runtime}>
            <IncOnMount />
            <Count />
          </OakProvider>
        </StrictMode>,
      ),
    )
    expect(counted.stats).toEqual({ builds: 1, disposals: 0 })
    // StrictMode runs IncOnMount's layout effect twice, against one program.
    expect(button()).toBe('2')
  })

  it("switches to the new runtime's program, and the old program keeps running", () => {
    const program = makeCounter()
    const first = testRuntime(program.layer)
    const second = testRuntime(program.layer)
    const app = (runtime: typeof first) => (
      <OakProvider program={program} runtime={runtime}>
        <Count />
      </OakProvider>
    )
    const { rerender } = render(app(first))
    fireEvent.click(screen.getByRole('button'))
    expect(button()).toBe('1')

    rerender(app(second))
    expect(button()).toBe('0')
    fireEvent.click(screen.getByRole('button'))
    expect(button()).toBe('1')

    act(() => first.runSync(program).dispatch(inc))
    expect(first.runSync(program).state.value.count).toBe(2)
    expect(button()).toBe('1')

    rerender(app(first))
    expect(button()).toBe('2')
  })

  it('keeps the program running while an <Activity> hides the provider', async () => {
    const ticker = makeTicker()
    const runtime = testRuntime(ticker.layer)
    const app = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <OakProvider program={ticker.program} runtime={runtime}>
          <Ticks />
        </OakProvider>
      </Activity>
    )
    const { rerender, container } = render(app('visible'))
    await act(async () => rerender(app('hidden')))
    const updates = ticker.stats.updates
    await act(() => sleep(30))
    expect(ticker.stats.updates).toBeGreaterThan(updates)
    await act(async () => rerender(app('visible')))
    expect(container.textContent).toBe('ticking')
    expect(ticker.stats).toMatchObject({ builds: 1, disposals: 0 })
  })

  it('serves a Runtime.Runtime without starting or stopping its program', async () => {
    const counted = makeCounted()
    const scope = Effect.runSync(Scope.make())
    const runtime = Effect.runSync(Layer.toRuntime(counted.layer).pipe(Scope.extend(scope)))
    const service = Runtime.runSync(runtime)(counted.program)
    service.dispatch(inc)

    const seen: Array<number> = []
    let dispatch: (msg: Msg) => void = () => {}
    function Seen() {
      seen.push(useSelector((m) => m.count))
      dispatch = useDispatch()
      return null
    }
    const { unmount } = render(
      <OakProvider program={counted.program} runtime={runtime}>
        <Seen />
      </OakProvider>,
    )
    expect(seen[0]).toBe(1)

    unmount()
    dispatch(inc)
    expect(service.state.value.count).toBe(2)
    expect(counted.stats).toEqual({ builds: 1, disposals: 0 })

    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(counted.stats).toEqual({ builds: 1, disposals: 1 })
    dispatch(inc)
    expect(service.state.value.count).toBe(2)
  })

  it('serves the runtime of a running Effect app', async () => {
    const counted = makeCounted()
    const rendered = Effect.runSync(Deferred.make<void>())
    const done = Effect.runSync(Deferred.make<void>())
    const seen: Array<number> = []
    function Seen() {
      seen.push(useSelector((m) => m.count))
      return null
    }
    // The app runs the program, sends it a message, then renders with its own runtime.
    const app = Effect.gen(function* () {
      const { dispatch } = yield* counted.program
      dispatch(inc)
      const runtime = yield* Effect.runtime<Context.Tag.Identifier<typeof counted.program>>()
      render(
        <OakProvider program={counted.program} runtime={runtime}>
          <Seen />
          <Count />
        </OakProvider>,
      )
      yield* Deferred.succeed(rendered, undefined)
      yield* Deferred.await(done)
    }).pipe(Effect.provide(counted.layer))
    const fiber = Effect.runFork(app)
    await Effect.runPromise(Deferred.await(rendered))

    expect(seen[0]).toBe(1)
    fireEvent.click(screen.getByRole('button'))
    expect(button()).toBe('2')
    cleanup()
    expect(counted.stats.disposals).toBe(0)

    await Effect.runPromise(Deferred.succeed(done, undefined))
    await Effect.runPromise(fiber.await)
    expect(counted.stats.disposals).toBe(1)
  })

  it('serves a ManagedRuntime whose async layer was built before the first render', async () => {
    const awaited = makeCounted()
    const runtime = testRuntime(
      Layer.merge(awaited.layer, Layer.effectDiscard(Effect.sleep('5 millis'))),
    )
    await runtime.runtime()
    render(
      <OakProvider program={awaited.program} runtime={runtime}>
        <Count />
      </OakProvider>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(button()).toBe('1')
  })
})

describe('OakProvider types', () => {
  it('accepts only a runtime or a layer that provides the program', () => {
    const counted = makeCounted()
    const ticker = makeTicker()
    const runtime = testRuntime(counted.layer)
    const tickerRuntime = testRuntime(ticker.layer)
    const bare = Effect.runSync(Effect.runtime<never>())

    interface Api {
      readonly next: Effect.Effect<number>
    }
    const Api = Context.GenericTag<Api>('test/Api')
    const withApi = makeProgram('test/WithApi', {
      init: { model: 0, effects: [] },
      update: (_msg: Msg, n: number) => ({ model: n, effects: [Effect.as(Api, inc)] }),
    })
    const program = counted.program

    // @ts-expect-error: the runtime provides test/Ticker, not test/Counter.
    expect(<OakProvider program={program} runtime={tickerRuntime} />).toBeTruthy()
    // @ts-expect-error: a Runtime without the program.
    expect(<OakProvider program={program} runtime={bare} />).toBeTruthy()
    // @ts-expect-error: the layer provides test/Ticker, not test/Counter.
    expect(<OakProvider program={program} layer={ticker.layer} />).toBeTruthy()
    // @ts-expect-error: the layer still requires Api.
    expect(<OakProvider program={withApi} layer={withApi.layer} />).toBeTruthy()
    // @ts-expect-error: runtime and layer together.
    expect(<OakProvider program={program} runtime={runtime} layer={counted.layer} />).toBeTruthy()

    // createElement compiles, but checks the runtime only when P is given.
    expect(createElement(OakProvider, { program, runtime })).toBeTruthy()
    expect(createElement(OakProvider, { program, layer: counted.layer })).toBeTruthy()
    expect(createElement(OakProvider<typeof program>, { program, runtime })).toBeTruthy()
    expect(
      // @ts-expect-error: the runtime provides test/Ticker, not test/Counter.
      createElement(OakProvider<typeof program>, { program, runtime: tickerRuntime }),
    ).toBeTruthy()
  })

  it('accepts a runtime or layer that provides more than the program', () => {
    const counted = makeCounted()
    const ticker = makeTicker()
    const both = Layer.merge(counted.layer, ticker.layer)
    const runtime = testRuntime(both)
    expect(<OakProvider program={counted.program} runtime={runtime} />).toBeTruthy()
    expect(<OakProvider program={ticker.program} layer={both} />).toBeTruthy()
  })
})
