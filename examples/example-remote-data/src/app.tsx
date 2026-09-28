import { Option } from 'effect'
import { OakProvider } from '@roughmagic/oak-react'
import { useDispatch, useSelector } from './hooks.js'
import { appRuntime } from './runtime.js'
import {
  isLoading,
  ItemMsg,
  itemKeys,
  ItemProgram,
  RemoteRecord,
  selectItem,
  type Item,
  type ItemKey,
  type Snapshot,
} from './oak-program/index.js'

function Spinner() {
  return <span className="spinner" role="status" aria-label="loading" />
}

function Value({ data, at }: Snapshot<Item>) {
  return (
    <>
      <output>{data.value}</output> <small>as of {new Date(at).toLocaleTimeString()}</small>
    </>
  )
}

const actionLabel = RemoteRecord.$match({
  NotRequested: () => 'Load',
  LoadingInitially: () => 'Loading...',
  Loaded: () => 'Refresh',
  Refreshing: () => 'Refreshing...',
  Errored: () => 'Retry',
})

function ItemRow({ itemKey }: { readonly itemKey: ItemKey }) {
  const record = useSelector(selectItem(itemKey))
  const dispatch = useDispatch()

  return (
    <li>
      <strong>{itemKey}</strong>
      <span>
        {RemoteRecord.$match(record, {
          NotRequested: () => <em>not requested</em>,
          LoadingInitially: () => <Spinner />,
          Loaded: ({ data, at }) => <Value data={data} at={at} />,
          Refreshing: ({ data, at }) => (
            <>
              <Value data={data} at={at} />
              <Spinner />
            </>
          ),
          Errored: ({ error, stale }) => (
            <>
              {Option.match(stale, {
                onNone: () => null,
                onSome: ({ data, at }) => <Value data={data} at={at} />,
              })}
              <span role="alert">{error}</span>
            </>
          ),
        })}
      </span>
      <button
        type="button"
        disabled={isLoading(record)}
        onClick={() => dispatch(ItemMsg.Request({ key: itemKey }))}
      >
        {actionLabel(record)}
      </button>
    </li>
  )
}

function ItemList() {
  const dispatch = useDispatch()

  return (
    <section>
      <h1>Oak remote data</h1>
      <p>
        Each row is one keyed <code>RemoteRecord</code>. Data on hand stays visible while a refresh
        runs or after a request fails.
      </p>
      <button type="button" onClick={() => dispatch(ItemMsg.RequestAll())}>
        Fetch all
      </button>
      <ul>
        {itemKeys.map((key) => (
          <ItemRow key={key} itemKey={key} />
        ))}
      </ul>
    </section>
  )
}

export function App() {
  return (
    <OakProvider runtime={appRuntime} program={ItemProgram}>
      <ItemList />
    </OakProvider>
  )
}
