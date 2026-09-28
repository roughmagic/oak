import { notRequested, type RemoteRecord } from './remote-record.js'

export type ItemKey = string

/** What the remote source returns for one key. */
export interface Item {
  readonly value: number
}

export type ItemStore = { readonly [key: ItemKey]: RemoteRecord<Item> }

export interface ItemModel {
  readonly items: ItemStore
}

export const itemKeys: ReadonlyArray<ItemKey> = ['alpha', 'bravo', 'charlie', 'delta', 'echo']

export const initialModel: ItemModel = { items: {} }

/** A missing key is `NotRequested`, so callers never handle an `Option`. */
export const getItem = (model: ItemModel, key: ItemKey): RemoteRecord<Item> =>
  model.items[key] ?? notRequested

export const setItem = (model: ItemModel, key: ItemKey, record: RemoteRecord<Item>): ItemModel => ({
  ...model,
  items: { ...model.items, [key]: record },
})
