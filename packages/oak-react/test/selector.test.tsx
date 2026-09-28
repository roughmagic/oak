import { act, cleanup, render, screen } from '@testing-library/react'
import { Effect, Layer } from 'effect'
import { StrictMode, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { OakProvider } from '../src/index.js'
import {
  Count,
  inc,
  makeCounter,
  testRuntime,
  useSelector,
  type Model,
  type Msg,
} from './programs.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// A user-land equality filter: it keeps the previous result while the new one is equal.
const keepEqual = <M, A>(selector: (model: M) => A, eq: (a: A, b: A) => boolean) => {
  let last: { readonly value: A } | undefined
  return (model: M): A => {
    const next = selector(model)
    if (last === undefined || !eq(last.value, next)) {
      last = { value: next }
    }
    return last.value
  }
}

const sameFields = <A extends object>(a: A, b: A) =>
  (Object.keys(a) as Array<keyof A>).every((key) => Object.is(a[key], b[key]))

const setup = () => {
  const program = makeCounter()
  const runtime = testRuntime(program.layer)
  const { dispatch } = runtime.runSync(program)
  const send = (msg: Msg) => act(() => dispatch(msg))
  const mount = (children: ReactNode) =>
    render(
      <OakProvider runtime={runtime} program={program}>
        {children}
      </OakProvider>,
    )
  return { send, mount }
}

describe('useSelector', () => {
  it('re-renders only when the selected value changes', () => {
    const { send, mount } = setup()
    let renders = 0
    function Count() {
      renders++
      return <p>{useSelector((m) => m.count)}</p>
    }

    mount(<Count />)
    send({ _tag: 'SetLabel', label: 'b' })
    expect(renders).toBe(1)
    send({ _tag: 'Inc' })
    expect(renders).toBe(2)
    expect(screen.getByRole('paragraph').textContent).toBe('1')
  })

  it('renders a selector that builds an object without looping', () => {
    const error = vi.spyOn(console, 'error')
    const { send, mount } = setup()
    function Header() {
      const header = useSelector((m) => ({ count: m.count, label: m.label }))
      return <p>{`${header.count}:${header.label}`}</p>
    }

    mount(
      <StrictMode>
        <Header />
      </StrictMode>,
    )
    send({ _tag: 'Inc' })
    send({ _tag: 'SetLabel', label: 'b' })
    expect(screen.getByRole('paragraph').textContent).toBe('1:b')
    expect(error).not.toHaveBeenCalled()
  })

  it('subscribes once across parent re-renders with an inline selector', () => {
    const program = makeCounter()
    let subscribes = 0
    // Wraps the program's service to count subscribe calls.
    const counting = Layer.effect(
      program,
      Effect.map(program, ({ state, dispatch }) => ({
        state: {
          get value() {
            return state.value
          },
          subscribe: (listener: (model: Model) => void) => {
            subscribes++
            return state.subscribe(listener)
          },
        },
        dispatch,
      })),
    )
    const runtime = testRuntime(counting.pipe(Layer.provide(program.layer)))
    function Label({ suffix }: { readonly suffix: string }) {
      return <p>{useSelector((m) => m.label + suffix)}</p>
    }
    const app = (suffix: string) => (
      <OakProvider runtime={runtime} program={program}>
        <Label suffix={suffix} />
      </OakProvider>
    )

    const { rerender } = render(app('!'))
    rerender(app('?'))
    rerender(app('!!'))
    act(() => runtime.runSync(program).dispatch({ _tag: 'SetLabel', label: 'b' }))
    expect(screen.getByRole('paragraph').textContent).toBe('b!!')
    expect(subscribes).toBe(1)
  })

  it('skips value-equal updates when the selector keeps equal results', () => {
    const { send, mount } = setup()
    const selectHeader = keepEqual((m: Model) => ({ count: m.count, label: m.label }), sameFields)
    let renders = 0
    function Header() {
      renders++
      const header = useSelector(selectHeader)
      return <p>{`${header.count}:${header.label}`}</p>
    }

    mount(<Header />)
    send({ _tag: 'Copy' })
    expect(renders).toBe(1)
    send({ _tag: 'Inc' })
    expect(renders).toBe(2)
    expect(screen.getByRole('paragraph').textContent).toBe('1:a')
  })

  it('hydrates against the init model when the program already runs outside React', async () => {
    const program = makeCounter()
    const runtime = testRuntime(program.layer)
    const app = (
      <OakProvider runtime={runtime} program={program}>
        <Count />
      </OakProvider>
    )
    const html = renderToString(app)
    runtime.runSync(program).dispatch(inc)

    const container = document.createElement('div')
    container.innerHTML = html
    const onRecoverableError = vi.fn()
    const root = await act(async () => hydrateRoot(container, app, { onRecoverableError }))
    onTestFinished(() => act(() => root.unmount()))
    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(container.textContent).toBe('1')
  })
})
