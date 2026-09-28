import { makeProgram } from '@roughmagic/oak'
import { emptyModel } from './model.js'
import { subscriptions } from './subscription.js'
import { requestBalance, update } from './update.js'

export {
  FakeLedger,
  Ledger,
  LedgerError,
  type FakeLedgerOptions,
  type TransferId,
  type TransferStatus,
} from './ledger.js'
export { TransferMsg } from './message.js'
export { Toast, TransferModel, TransferState, emptyModel } from './model.js'
export { subscriptions } from './subscription.js'
export { update } from './update.js'

export const TransferProgram = makeProgram('@roughmagic/example-programs/Transfer', {
  // Elm's init with a command: the program asks for the balance as soon as it starts.
  init: requestBalance(emptyModel),
  update,
  subscriptions,
})
