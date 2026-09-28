# `@roughmagic/example-remote-data`

Keyed remote data with stale-while-revalidate records.

Five keys share one store. A row loads on demand, keeps its data visible while
a refresh runs, and keeps it after a failure. The remote source is simulated:
400 to 1400 ms per request, one failure in four.

Run it from the repo root. Vite reads the Oak packages from their `dist`
folders, and Turbo's `dev` task does not build them, so build once first:

```sh
pnpm build --filter=@roughmagic/example-remote-data
pnpm dev --filter=@roughmagic/example-remote-data
pnpm test --filter=@roughmagic/example-remote-data
```

## The record

`src/oak-program/remote-record.ts` is generic and has no Oak dependency.

```ts
type RemoteRecord<T> = Data.TaggedEnum<{
  NotRequested: {}
  LoadingInitially: {}
  Loaded: { data: T; at: Timestamp }
  Refreshing: { data: T; at: Timestamp }
  Errored: { error: string; stale: Option<{ data: T; at: Timestamp }> }
}>
```

Two transitions carry the stale-while-revalidate rule, and both derive from
`snapshot`, which is the data on hand in any state:

- `toLoading(record)` is `Refreshing` when a snapshot exists, else
  `LoadingInitially`.
- `toErrored(record, error)` is `Errored` with whatever snapshot existed.

## The store

```ts
type ItemStore = { readonly [key: ItemKey]: RemoteRecord<Item> }
```

`getItem(model, key)` returns `NotRequested` for a missing key. A selector
therefore returns a `RemoteRecord`, never an `Option<RemoteRecord>`. The
`NotRequested` value is one shared instance, so `useSelector` sees a stable
value for keys that were never requested.

## The messages

| Message                      | Effect on the record                        |
| ---------------------------- | ------------------------------------------- |
| `Request { key }`            | `toLoading`, plus one fetch command         |
| `RequestAll`                 | `Request` for every key that is not loading |
| `Received { key, data, at }` | `Loaded`                                    |
| `Failed { key, error }`      | `toErrored`                                 |

`Request` on a loading record is a no-op, so at most one request per key is in
flight. That is why `Received` needs no request id: it cannot race an older
response for the same key.

This drop-while-loading rule fits a refresh that the user clicks. It does not
fit data that an event makes stale while a fetch is in flight. The response to
that fetch carries the old value, and the rule drops the new request. For that
case, put a request id in the model and in `Received`, and ignore a response
whose id is not the latest. The [root README](../../README.md#stale-responses) shows this
guard.

The rule also relies on a fixed key set. If keys can be dropped while a fetch
is in flight, derive the fetch from the model as a keyed subscription instead.
Oak then interrupts the fetch when the key leaves. A response can still arrive
after its key has left, so `update` applies a response only while the record
is loading.

The fetch is a command, typed `Command<ItemMsg, ItemApi>`. It reads `ItemApi`
from the Effect context, stamps the result with `Clock.currentTimeMillis`, and
turns the typed failure into `Failed`. Its error type is therefore `never`, as
Oak requires.

## The program

`src/oak-program/program.ts` makes the program once, at module scope:

```ts
export const ItemProgram = makeProgram('@roughmagic/example-remote-data/Item', {
  init: { model: initialModel, commands: [] },
  update,
})
```

`update` is typed `Update<ItemModel, ItemMsg, ItemApi>`, so the program's
layer requires `ItemApi`. `src/runtime.ts` provides it under the program
layer:

```ts
export const appRuntime = ManagedRuntime.make(ItemProgram.layer.pipe(Layer.provide(ItemApiLive)))
```

`src/hooks.ts` makes the typed hooks, and `App` renders one `OakProvider`
with `runtime={appRuntime}` and `program={ItemProgram}`.

## The view

`ItemRow` selects one record with `useSelector(selectItem(itemKey))` and
renders it with `RemoteRecord.$match`. `Refreshing` shows the value and a
spinner. `Errored` shows the stale value, if any, and the error. The button is
disabled while the record is loading.

## The tests

- `test/remote-record.test.ts` tests the record transitions.
- `test/update.test.ts` calls `update` directly, and runs the fetch command
  on a fake `ItemApi` layer.
- `test/program.test.ts` runs the whole program on Effect's `TestClock`, as
  the [root README](../../README.md#testing) shows. The fake `ItemApi` answers
  after one second on Effect's `Clock`, and `TestClock.adjust('1 second')`
  lets each answer arrive. `Effect.provide` builds a new program for each
  test, from `init`, and closes it when the test ends.
