import { Data } from 'effect'

export type RandomMsg = Data.TaggedEnum<{
  Fetch: {}
  Set: { readonly value: number }
}>

export const RandomMsg = Data.taggedEnum<RandomMsg>()
