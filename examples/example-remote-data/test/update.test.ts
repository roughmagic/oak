import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { ItemApi, ItemFetchError } from '../src/oak-program/item-api.js'
import { ItemMsg } from '../src/oak-program/message.js'
import {
  getItem,
  initialModel,
  itemKeys,
  setItem,
  type ItemModel,
} from '../src/oak-program/model.js'
import { RemoteRecord } from '../src/oak-program/remote-record.js'
import { update } from '../src/oak-program/update.js'

const loaded = RemoteRecord.Loaded({ data: { value: 1 }, at: 1_000 })
const withAlpha = (record: RemoteRecord<{ value: number }>): ItemModel =>
  setItem(initialModel, 'alpha', record)

describe('update', () => {
  it('Request on a fresh key loads initially and issues one fetch', () => {
    const { model, commands } = update(ItemMsg.Request({ key: 'alpha' }), initialModel)
    expect(getItem(model, 'alpha')).toEqual(RemoteRecord.LoadingInitially())
    expect(commands).toHaveLength(1)
  })

  it('Request on a loaded key refreshes and keeps the data', () => {
    const { model, commands } = update(ItemMsg.Request({ key: 'alpha' }), withAlpha(loaded))
    expect(getItem(model, 'alpha')).toEqual(
      RemoteRecord.Refreshing({ data: { value: 1 }, at: 1_000 }),
    )
    expect(commands).toHaveLength(1)
  })

  it('Request on a loading key is a no-op', () => {
    const before = withAlpha(RemoteRecord.Refreshing({ data: { value: 1 }, at: 1_000 }))
    const { model, commands } = update(ItemMsg.Request({ key: 'alpha' }), before)
    expect(model).toBe(before)
    expect(commands).toHaveLength(0)
  })

  it('RequestAll skips keys that are already loading', () => {
    const before = withAlpha(RemoteRecord.LoadingInitially())
    const { model, commands } = update(ItemMsg.RequestAll(), before)
    expect(commands).toHaveLength(itemKeys.length - 1)
    for (const key of itemKeys) {
      expect(getItem(model, key)).toEqual(RemoteRecord.LoadingInitially())
    }
  })

  it('Received stores the data and the time', () => {
    const before = withAlpha(RemoteRecord.LoadingInitially())
    const { model, commands } = update(
      ItemMsg.Received({ key: 'alpha', data: { value: 7 }, at: 2_000 }),
      before,
    )
    expect(getItem(model, 'alpha')).toEqual(RemoteRecord.Loaded({ data: { value: 7 }, at: 2_000 }))
    expect(commands).toHaveLength(0)
  })

  it('Failed keeps the data on hand', () => {
    const before = withAlpha(RemoteRecord.Refreshing({ data: { value: 1 }, at: 1_000 }))
    const { model } = update(ItemMsg.Failed({ key: 'alpha', error: 'down' }), before)
    expect(getItem(model, 'alpha')).toEqual(
      RemoteRecord.Errored({
        error: 'down',
        stale: Option.some({ data: { value: 1 }, at: 1_000 }),
      }),
    )
  })

  it('leaves other keys untouched by reference', () => {
    const before = withAlpha(loaded)
    const { model } = update(ItemMsg.Request({ key: 'bravo' }), before)
    expect(getItem(model, 'alpha')).toBe(loaded)
  })

  it('the fetch command turns success and failure into messages', async () => {
    const { commands } = update(ItemMsg.Request({ key: 'alpha' }), initialModel)
    const command = commands[0]!

    const up = Layer.succeed(ItemApi, ItemApi.of({ fetch: () => Effect.succeed({ value: 7 }) }))
    const received = await Effect.runPromise(Effect.provide(command, up))
    expect(received._tag).toBe('Received')
    if (received._tag === 'Received') {
      expect(received.key).toBe('alpha')
      expect(received.data).toEqual({ value: 7 })
      expect(typeof received.at).toBe('number')
    }

    const down = Layer.succeed(
      ItemApi,
      ItemApi.of({ fetch: (key) => Effect.fail(new ItemFetchError({ key, message: 'down' })) }),
    )
    const failed = await Effect.runPromise(Effect.provide(command, down))
    expect(failed).toEqual(ItemMsg.Failed({ key: 'alpha', error: 'down' }))
  })
})
