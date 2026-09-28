import { Data } from 'effect'

export const dieIds = ['one', 'two', 'three'] as const

export type DieId = (typeof dieIds)[number]

export interface DieState {
  readonly value: number
  readonly rolling: boolean
}

export interface AutoRollState {
  readonly enabled: boolean
  readonly intervalMs: number
  readonly ticks: number
}

export type Dice = { readonly [Id in DieId]: DieState }

export interface DiceModel {
  readonly dice: Dice
  readonly autoRoll: AutoRollState
}

export const DieState = Data.case<DieState>()
export const Dice = Data.case<Dice>()
export const AutoRollState = Data.case<AutoRollState>()
export const DiceModel = Data.case<DiceModel>()

const die = DieState({ value: 1, rolling: false })

export const initialModel = DiceModel({
  dice: Dice({ one: die, two: die, three: die }),
  autoRoll: AutoRollState({ enabled: false, intervalMs: 2_000, ticks: 0 }),
})
