import { Clock, Effect } from 'effect'
import type { Command, Update } from '@roughmagic/oak'
import { ItemApi } from './item-api.js'
import { ItemMsg } from './message.js'
import { getItem, itemKeys, setItem, type ItemKey, type ItemModel } from './model.js'
import { isLoading, RemoteRecord, toErrored, toLoading } from './remote-record.js'

const fetchItem = (key: ItemKey): Command<ItemMsg, ItemApi> =>
  Effect.gen(function* () {
    const api = yield* ItemApi
    const data = yield* api.fetch(key)
    const at = yield* Clock.currentTimeMillis
    return ItemMsg.Received({ key, data, at })
  }).pipe(Effect.catchAll((error) => Effect.succeed(ItemMsg.Failed({ key, error: error.message }))))

// At most one request per key is in flight: `Request` on a loading record is a
// no-op. So `Received` and `Failed` never race and need no request id.
const request = (model: ItemModel, keys: ReadonlyArray<ItemKey>) => {
  const idle = keys.filter((key) => !isLoading(getItem(model, key)))
  return {
    model: idle.reduce((next, key) => setItem(next, key, toLoading(getItem(next, key))), model),
    effects: idle.map(fetchItem),
  }
}

export const update: Update<ItemModel, ItemMsg, ItemApi> = (msg, model) =>
  ItemMsg.$match(msg, {
    Request: ({ key }) => request(model, [key]),
    RequestAll: () => request(model, itemKeys),
    Received: ({ key, data, at }) => ({
      model: setItem(model, key, RemoteRecord.Loaded({ data, at })),
      effects: [],
    }),
    Failed: ({ key, error }) => ({
      model: setItem(model, key, toErrored(getItem(model, key), error)),
      effects: [],
    }),
  })
