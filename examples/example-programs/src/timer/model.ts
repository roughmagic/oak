import { Data } from 'effect'

export interface TimerModel {
  readonly ticks: number
  readonly intervalMs: number
}

export const TimerModel = Data.case<TimerModel>()

export const initialModel = TimerModel({ ticks: 0, intervalMs: 1000 })
