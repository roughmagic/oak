import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context, Effect, Layer } from 'effect'
import { Activity, StrictMode, Suspense, use, useLayoutEffect, useState } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { makeProgram } from '@roughmagic/oak'
import { OakProvider, createOakHooks } from '../src/index.js'
import {
  Boundary,
  Count,
  IncOnMount,
  counting,
  inc,
  makeCounted,
  makeCounter,
  sleep,
  testRuntime,
  update,
  useDispatch,
  useSelector,
  type Model,
  type Msg,
} from './programs.js'

afterEach(async () => {
  cleanup()
  await sleep(0)
  vi.restoreAllMocks()
})

const button = () => screen.getByRole('button').textContent

describe('OakProvider with a layer', () => {
  it('builds the layer in the commit phase and disposes it after unmount', async () => {
    const counted = makeCounted()
    const seen: Array<number> = []
    function Seen() {
      useSelector((m) => m.count)
      seen.push(counted.stats.builds)
      return null
    }
    const { unmount } = render(
      <OakProvider program={counted.program} layer={counted.layer}>
        <Seen />
        <Count />
      </OakProvider>,
    )
    expect(seen[0]).toBe(0)
    expect(counted.stats).toEqual({ builds: 1, disposals: 0 })

    unmount()
    await sleep(5)
    expect(counted.stats).toEqual({ builds: 1, disposals: 1 })
  })

  it('starts once under StrictMode, and the replayed layout effect reaches the same program', async () => {
    const counted = makeCounted()
    const { unmount } = await act(async () =>
      render(
        <StrictMode>
          <OakProvider program={counted.program} layer={counted.layer}>
            <IncOnMount />
            <Count />
          </OakProvider>
        </StrictMode>,
      ),
    )
    await act(() => sleep(5))
    expect(counted.stats).toEqual({ builds: 1, disposals: 0 })
    // StrictMode runs IncOnMount's layout effect twice, against one program.
    expect(button()).toBe('2')
    fireEvent.click(screen.getByRole('button'))
    expect(button()).toBe('3')

    unmount()
    await sleep(5)
    expect(counted.stats).toEqual({ builds: 1, disposals: 1 })
  })

  it.each([
    ['from the start', false],
    ['mounted while hidden', true],
  ])(
    'disposes when an <Activity> hides it and starts over from init when shown (%s)',
    async (_name, late) => {
      const error = vi.spyOn(console, 'error')
      const counted = makeCounted(0, [Effect.succeed(inc)])
      const app = (mode: 'visible' | 'hidden', withInc: boolean) => (
        <Activity mode={mode}>
          <OakProvider program={counted.program} layer={counted.layer}>
            {withInc ? <IncOnMount /> : null}
            <Count />
          </OakProvider>
        </Activity>
      )
      const { rerender } = render(app('visible', !late))
      fireEvent.click(screen.getByRole('button'))
      expect(button()).toBe(late ? '2' : '3')

      await act(async () => {
        rerender(app('hidden', !late))
        await sleep(5)
      })
      expect(counted.stats).toEqual({ builds: 1, disposals: 1 })
      await act(async () => rerender(app('hidden', true)))
      expect(counted.stats.builds).toBe(1)

      await act(async () => rerender(app('visible', true)))
      expect(counted.stats).toEqual({ builds: 2, disposals: 1 })
      // The init command and IncOnMount, on the new program.
      expect(button()).toBe('2')
      fireEvent.click(screen.getByRole('button'))
      expect(button()).toBe('3')
      expect(error).not.toHaveBeenCalled()
    },
  )

  it('builds once per <Activity> show under StrictMode', async () => {
    const counted = makeCounted()
    const app = (mode: 'visible' | 'hidden') => (
      <StrictMode>
        <Activity mode={mode}>
          <OakProvider program={counted.program} layer={counted.layer}>
            <Count />
          </OakProvider>
        </Activity>
      </StrictMode>
    )
    const { rerender } = await act(async () => render(app('visible')))
    for (let cycle = 1; cycle <= 3; cycle++) {
      await act(async () => {
        rerender(app('hidden'))
        await sleep(5)
      })
      await act(async () => {
        rerender(app('visible'))
        await sleep(5)
      })
      expect(counted.stats).toEqual({ builds: cycle + 1, disposals: cycle })
    }
  })

  it('builds nothing while it mounts inside a hidden <Activity>', async () => {
    const counted = makeCounted()
    const app = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <OakProvider program={counted.program} layer={counted.layer}>
          <IncOnMount />
          <Count />
        </OakProvider>
      </Activity>
    )
    const { rerender, container } = await act(async () => render(app('hidden')))
    await act(() => sleep(10))
    expect(counted.stats.builds).toBe(0)
    expect(container.textContent).toBe('0')

    await act(async () => rerender(app('visible')))
    expect(counted.stats.builds).toBe(1)
    expect(button()).toBe('1')
  })

  it.each([
    ['plain', false],
    ['StrictMode', true],
  ])(
    'keeps the program running while a Suspense boundary above it shows its fallback (%s)',
    async (_mode, strict) => {
      const counted = makeCounted()
      let resolve = () => {}
      const pending = new Promise<void>((r) => {
        resolve = r
      })
      function SuspendAtTwo() {
        if (useSelector((m) => m.count) === 2) {
          use(pending)
        }
        return null
      }
      const app = (
        <Suspense fallback={<p>fallback</p>}>
          <OakProvider program={counted.program} layer={counted.layer}>
            <SuspendAtTwo />
            <Count />
          </OakProvider>
        </Suspense>
      )
      await act(async () => render(strict ? <StrictMode>{app}</StrictMode> : app))
      fireEvent.click(screen.getByRole('button'))
      expect(button()).toBe('1')

      await act(async () => {
        fireEvent.click(screen.getByRole('button'))
        await sleep(5)
      })
      expect(screen.getByText('fallback')).toBeTruthy()
      expect(counted.stats).toEqual({ builds: 1, disposals: 0 })

      await act(async () => {
        resolve()
        await sleep(5)
      })
      expect(counted.stats).toEqual({ builds: 1, disposals: 0 })
      expect(button()).toBe('2')
    },
  )

  it('reads an inline program and layer on the first render only', async () => {
    const { stats, layer } = counting()
    function App() {
      const [, setRenders] = useState(0)
      const program = makeCounter()
      return (
        <OakProvider program={program} layer={Layer.merge(program.layer, layer)}>
          <Count />
          <p onClick={() => setRenders((n) => n + 1)}>rerender</p>
        </OakProvider>
      )
    }
    render(<App />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('rerender'))
    fireEvent.click(screen.getByText('rerender'))
    await act(() => sleep(5))
    expect(stats).toEqual({ builds: 1, disposals: 0 })
    expect(button()).toBe('1')
  })

  it.each([
    ['plain', false],
    ['StrictMode', true],
  ])('disposes every runtime when a sibling layout effect throws (%s)', async (_mode, strict) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const counted = makeCounted()
    function Throws(): null {
      useLayoutEffect(() => {
        throw new Error('layout effect failed')
      }, [])
      return null
    }
    const app = (
      <Boundary>
        <OakProvider program={counted.program} layer={counted.layer}>
          <Throws />
        </OakProvider>
      </Boundary>
    )
    render(strict ? <StrictMode>{app}</StrictMode> : app)
    await act(() => sleep(10))
    expect(screen.getByText('caught')).toBeTruthy()
    expect(counted.stats.builds).toBeGreaterThan(0)
    expect(counted.stats.disposals).toBe(counted.stats.builds)
  })

  it('shares the services of an app-wide runtime without building or disposing them', async () => {
    interface Api {
      readonly next: Effect.Effect<number>
    }
    const Api = Context.GenericTag<Api>('test/Api')
    const api = { builds: 0, disposals: 0 }
    const ApiLive = Layer.scoped(
      Api,
      Effect.acquireRelease(
        Effect.sync(() => {
          api.builds++
          return { next: Effect.succeed(42) }
        }),
        () =>
          Effect.sync(() => {
            api.disposals++
          }),
      ),
    )
    const host = testRuntime(ApiLive)
    type Loaded = { readonly _tag: 'Loaded'; readonly value: number }
    const program = makeProgram('test/Loader', {
      init: {
        model: 0,
        commands: [
          Effect.flatMap(Api, (api) => api.next).pipe(
            Effect.map((value): Loaded => ({ _tag: 'Loaded', value })),
          ),
        ],
      },
      update: (msg: Loaded) => ({ model: msg.value, commands: [] }),
    })
    const { useSelector } = createOakHooks<number, Loaded>()
    function Value() {
      return <output>{useSelector((n) => n)}</output>
    }
    const hostServices = Layer.effectContext(Effect.map(host, (runtime) => runtime.context))
    const app = (
      <OakProvider program={program} layer={program.layer.pipe(Layer.provide(hostServices))}>
        <Value />
      </OakProvider>
    )

    for (let mount = 0; mount < 2; mount++) {
      const { unmount } = render(app)
      expect(await screen.findByText('42')).toBeTruthy()
      unmount()
      await sleep(5)
    }
    expect(api).toEqual({ builds: 1, disposals: 0 })
  })

  it('hydrates against the init model, then starts', async () => {
    const counted = makeCounted(0, [Effect.succeed(inc)])
    const app = (
      <OakProvider program={counted.program} layer={counted.layer}>
        <Count />
      </OakProvider>
    )
    const html = renderToString(app)
    expect(counted.stats.builds).toBe(0)
    const container = document.createElement('div')
    container.innerHTML = html
    expect(container.textContent).toBe('0')

    const onRecoverableError = vi.fn()
    const root = await act(async () => hydrateRoot(container, app, { onRecoverableError }))
    onTestFinished(() => act(() => root.unmount()))
    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(counted.stats.builds).toBe(1)
    expect(container.textContent).toBe('1')
  })

  it('ignores dispatch after the program stops', async () => {
    let updates = 0
    const program = makeProgram('test/Counter', {
      init: { model: { count: 0, label: 'a' }, commands: [] },
      update: (msg: Msg, model: Model) => {
        updates++
        return update(msg, model)
      },
    })
    let dispatch: (msg: Msg) => void = () => {}
    function Keep() {
      dispatch = useDispatch()
      return null
    }
    const { unmount } = await act(async () =>
      render(
        <OakProvider program={program} layer={program.layer}>
          <Keep />
          <Count />
        </OakProvider>,
      ),
    )
    act(() => dispatch(inc))
    expect(updates).toBe(1)
    expect(button()).toBe('1')

    unmount()
    await sleep(5)
    expect(() => dispatch(inc)).not.toThrow()
    expect(updates).toBe(1)
  })
})
