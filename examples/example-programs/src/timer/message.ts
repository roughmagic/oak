import { Data } from 'effect'

export type TimerMsg = Data.TaggedEnum<{
  Tick: {}
  Reset: {}
  SetInterval: { readonly ms: number }
}>

export const TimerMsg = Data.taggedEnum<TimerMsg>()
