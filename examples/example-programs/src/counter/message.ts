import { Data } from 'effect'

export type CounterMsg = Data.TaggedEnum<{
  Increment: {}
  Decrement: {}
}>

export const CounterMsg = Data.taggedEnum<CounterMsg>()
