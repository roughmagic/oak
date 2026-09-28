import { Data } from 'effect'
import type { Item, ItemKey } from './model.js'
import type { Timestamp } from './remote-record.js'

export type ItemMsg = Data.TaggedEnum<{
  Request: { readonly key: ItemKey }
  RequestAll: {}
  Received: { readonly key: ItemKey; readonly data: Item; readonly at: Timestamp }
  Failed: { readonly key: ItemKey; readonly error: string }
}>

export const ItemMsg = Data.taggedEnum<ItemMsg>()
