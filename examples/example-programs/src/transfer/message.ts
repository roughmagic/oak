import { Data } from 'effect'
import type { TransferId } from './ledger.js'

/**
 * A balance result, a `Settled` and a `ToastExpired` carry the id of what they answer. `update`
 * compares the id with the model and ignores a result for something that is gone. A submit
 * result needs no id: `TransferRequested` is ignored unless the transfer is idle, so at most one
 * submit is in flight.
 */
export type TransferMsg = Data.TaggedEnum<{
  TransferRequested: { readonly to: string; readonly amount: number }
  Submitted: { readonly id: TransferId }
  SubmitFailed: { readonly error: string }
  Settled: { readonly id: TransferId }
  BalanceRequested: {}
  BalanceLoaded: { readonly request: number; readonly balance: number }
  BalanceFailed: { readonly request: number; readonly error: string }
  ToastDismissed: { readonly id: number }
  ToastExpired: { readonly id: number }
}>

export const TransferMsg = Data.taggedEnum<TransferMsg>()
