import { Data, Option } from 'effect'

/** Milliseconds since the Unix epoch. */
export type Timestamp = number

/** Data from the remote source and when it arrived. */
export interface Snapshot<T> {
  readonly data: T
  readonly at: Timestamp
}

/**
 * One remote value and the state of its last request.
 *
 * `Refreshing` and `Errored` keep the snapshot on hand, so a view can show
 * stale data while a request is in flight or after one has failed.
 */
export type RemoteRecord<T> = Data.TaggedEnum<{
  NotRequested: {}
  LoadingInitially: {}
  Loaded: Snapshot<T>
  Refreshing: Snapshot<T>
  Errored: { readonly error: string; readonly stale: Option.Option<Snapshot<T>> }
}>

interface RemoteRecordDefinition extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: RemoteRecord<this['A']>
}

export const RemoteRecord = Data.taggedEnum<RemoteRecordDefinition>()

// One shared instance, so a selector returns a stable value for an absent key.
export const notRequested = RemoteRecord.NotRequested()

export const isLoading = <T>(record: RemoteRecord<T>): boolean =>
  record._tag === 'LoadingInitially' || record._tag === 'Refreshing'

/** The data on hand, fresh or stale. */
export const snapshot = <T>(record: RemoteRecord<T>): Option.Option<Snapshot<T>> =>
  RemoteRecord.$match(record, {
    NotRequested: () => Option.none(),
    LoadingInitially: () => Option.none(),
    Loaded: ({ data, at }) => Option.some({ data, at }),
    Refreshing: ({ data, at }) => Option.some({ data, at }),
    Errored: ({ stale }) => stale,
  })

/** The record while a request is in flight. Data on hand stays visible. */
export const toLoading = <T>(record: RemoteRecord<T>): RemoteRecord<T> =>
  Option.match(snapshot(record), {
    onNone: () => RemoteRecord.LoadingInitially(),
    onSome: (kept) => RemoteRecord.Refreshing(kept),
  })

/** The record after a failed request. Data on hand stays visible. */
export const toErrored = <T>(record: RemoteRecord<T>, error: string): RemoteRecord<T> =>
  RemoteRecord.Errored({ error, stale: snapshot(record) })
