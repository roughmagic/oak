import { Data } from 'effect'
import type { DieId } from './model.js'

export type DiceMsg = Data.TaggedEnum<{
  Roll: { readonly die: DieId }
  RollAll: {}
  ToggleAutoRoll: {}
  AutoRollTick: {}
  Rolled: { readonly die: DieId; readonly value: number }
}>

export const DiceMsg = Data.taggedEnum<DiceMsg>()
