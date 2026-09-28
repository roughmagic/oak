import { Data } from 'effect'
import type { TransferId } from './ledger.js'

/** The current transfer. The program runs one transfer at a time. */
export type TransferState = Data.TaggedEnum<{
  Idle: {}
  Submitting: {}
  Pending: { readonly id: TransferId }
}>

export const TransferState = Data.taggedEnum<TransferState>()

export interface Toast {
  readonly id: number
  readonly text: string
}

export const Toast = Data.case<Toast>()

export interface TransferModel {
  /** The last balance loaded, or null before the first load. A refetch keeps it on screen. */
  readonly balance: number | null
  /** The id of the latest balance request. A response with another id is stale. */
  readonly balanceRequest: number
  readonly balanceLoading: boolean
  readonly transfer: TransferState
  readonly toasts: ReadonlyArray<Toast>
  /** The id of the next toast. */
  readonly nextToastId: number
}

export const TransferModel = Data.case<TransferModel>()

/** The model before `init` runs. `init` starts the first balance request from it. */
export const emptyModel = TransferModel({
  balance: null,
  balanceRequest: 0,
  balanceLoading: false,
  transfer: TransferState.Idle(),
  toasts: [],
  nextToastId: 1,
})
