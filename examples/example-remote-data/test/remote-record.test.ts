import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  isLoading,
  notRequested,
  RemoteRecord,
  snapshot,
  toErrored,
  toLoading,
} from '../src/oak-program/remote-record.js'

const loaded = RemoteRecord.Loaded({ data: 1, at: 1_000 })
const kept = Option.some({ data: 1, at: 1_000 })

describe('RemoteRecord', () => {
  it('loads initially when nothing is on hand', () => {
    expect(toLoading(notRequested)).toEqual(RemoteRecord.LoadingInitially())
    expect(toLoading(RemoteRecord.Errored({ error: 'x', stale: Option.none() }))).toEqual(
      RemoteRecord.LoadingInitially(),
    )
  })

  it('refreshes when data is on hand', () => {
    expect(toLoading(loaded)).toEqual(RemoteRecord.Refreshing({ data: 1, at: 1_000 }))
    expect(toLoading(RemoteRecord.Errored({ error: 'x', stale: kept }))).toEqual(
      RemoteRecord.Refreshing({ data: 1, at: 1_000 }),
    )
  })

  it('keeps data on hand through a failure', () => {
    expect(toErrored(loaded, 'boom')).toEqual(RemoteRecord.Errored({ error: 'boom', stale: kept }))
    expect(toErrored(RemoteRecord.Refreshing({ data: 1, at: 1_000 }), 'boom')).toEqual(
      RemoteRecord.Errored({ error: 'boom', stale: kept }),
    )
    expect(toErrored(notRequested, 'boom')).toEqual(
      RemoteRecord.Errored({ error: 'boom', stale: Option.none() }),
    )
  })

  it('replaces the error but not the stale data on a second failure', () => {
    const twice = toErrored(toErrored(loaded, 'first'), 'second')
    expect(twice).toEqual(RemoteRecord.Errored({ error: 'second', stale: kept }))
  })

  it('exposes the snapshot in every state that has one', () => {
    expect(snapshot(notRequested)).toEqual(Option.none())
    expect(snapshot(RemoteRecord.LoadingInitially())).toEqual(Option.none())
    expect(snapshot(loaded)).toEqual(kept)
    expect(snapshot(toLoading(loaded))).toEqual(kept)
    expect(snapshot(toErrored(loaded, 'boom'))).toEqual(kept)
  })

  it('is loading in exactly the two in-flight states', () => {
    expect(isLoading(notRequested)).toBe(false)
    expect(isLoading(RemoteRecord.LoadingInitially())).toBe(true)
    expect(isLoading(loaded)).toBe(false)
    expect(isLoading(toLoading(loaded))).toBe(true)
    expect(isLoading(toErrored(loaded, 'boom'))).toBe(false)
  })
})
