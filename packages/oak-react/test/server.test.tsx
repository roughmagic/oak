// @vitest-environment node
import { ManagedRuntime } from 'effect'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, onTestFinished } from 'vitest'
import { OakProvider } from '../src/index.js'
import { Count, TickerApp, Ticks, inc, makeCounted, makeTicker, sleep } from './programs.js'

describe('server render', () => {
  it('renders the init model with a layer, and builds and runs nothing', async () => {
    const ticker = makeTicker()
    expect(renderToString(<TickerApp ticker={ticker} />)).toBe('<output>idle</output>')
    await sleep(30)
    expect(ticker.stats).toEqual({ builds: 0, disposals: 0, updates: 0 })
  })

  it('renders the init model with a ManagedRuntime, and builds and runs nothing', async () => {
    const ticker = makeTicker()
    const runtime = ManagedRuntime.make(ticker.layer)
    onTestFinished(() => runtime.dispose())
    const html = renderToString(
      <OakProvider program={ticker.program} runtime={runtime}>
        <Ticks />
      </OakProvider>,
    )
    expect(html).toBe('<output>idle</output>')
    await sleep(30)
    expect(ticker.stats).toEqual({ builds: 0, disposals: 0, updates: 0 })
  })

  it('renders the init model with a Runtime whose program has moved on', async () => {
    const counted = makeCounted()
    const managed = ManagedRuntime.make(counted.layer)
    onTestFinished(() => managed.dispose())
    const runtime = await managed.runtime()
    managed.runSync(counted.program).dispatch(inc)
    expect(managed.runSync(counted.program).state.value.count).toBe(1)

    const html = renderToString(
      <OakProvider program={counted.program} runtime={runtime}>
        <Count />
      </OakProvider>,
    )
    expect(html).toBe('<button>0</button>')
  })
})
