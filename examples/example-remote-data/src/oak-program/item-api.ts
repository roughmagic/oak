import { Context, Data, Effect, Layer, Random } from 'effect'
import type { Item, ItemKey } from './model.js'

export class ItemFetchError extends Data.TaggedError('ItemFetchError')<{
  readonly key: ItemKey
  readonly message: string
}> {}

export interface ItemApi {
  readonly fetch: (key: ItemKey) => Effect.Effect<Item, ItemFetchError>
}

export const ItemApi = Context.GenericTag<ItemApi>('@roughmagic/example-remote-data/ItemApi')

/** A slow, flaky remote source: 400 to 1400 ms per request, one failure in four. */
export const ItemApiLive: Layer.Layer<ItemApi> = Layer.succeed(
  ItemApi,
  ItemApi.of({
    fetch: (key) =>
      Effect.gen(function* () {
        yield* Effect.sleep(yield* Random.nextIntBetween(400, 1400))
        if ((yield* Random.next) < 0.25) {
          return yield* new ItemFetchError({ key, message: `Simulated network failure for ${key}` })
        }
        return { value: yield* Random.nextIntBetween(0, 1000) }
      }),
  }),
)
