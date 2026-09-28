import * as Optic from '@fp-ts/optic'
import type { Command, NextModel, Update } from '@roughmagic/oak'
import { Array as Arr, Effect, pipe } from 'effect'
import { caseIso } from '../optic.js'
import { Ledger } from './ledger.js'
import { TransferMsg } from './message.js'
import { Toast, TransferModel, TransferState } from './model.js'

type TransferNext = NextModel<TransferModel, TransferMsg, Ledger>

const _model = caseIso(TransferModel)
const _balance = _model.at('balance')
const _balanceRequest = _model.at('balanceRequest')
const _balanceLoading = _model.at('balanceLoading')
const _transfer = _model.at('transfer')
const _toasts = _model.at('toasts')
const _nextToastId = _model.at('nextToastId')

const submit = (to: string, amount: number): Command<TransferMsg, Ledger> =>
  Effect.flatMap(Ledger, (ledger) => ledger.submit({ to, amount })).pipe(
    Effect.match({
      onSuccess: (id) => TransferMsg.Submitted({ id }),
      onFailure: (error) => TransferMsg.SubmitFailed({ error: error.message }),
    }),
  )

const loadBalance = (request: number): Command<TransferMsg, Ledger> =>
  Effect.flatMap(Ledger, (ledger) => ledger.balance).pipe(
    Effect.match({
      onSuccess: (balance) => TransferMsg.BalanceLoaded({ request, balance }),
      onFailure: (error) => TransferMsg.BalanceFailed({ request, error: error.message }),
    }),
  )

// A delayed command, not a subscription: the timer starts once, when the toast appears, and
// nothing ever needs to stop it. A toast dismissed early leaves a late ToastExpired behind, and
// update ignores it.
const expireToast = (id: number): Command<TransferMsg> =>
  Effect.as(Effect.sleep('4 seconds'), TransferMsg.ToastExpired({ id }))

/**
 * Starts a balance request under a new id. BalanceRequested and Settled both call it, so the
 * refetch after a transfer is the same step as a refresh the user asks for.
 */
export const requestBalance = (model: TransferModel): TransferNext => {
  const request = model.balanceRequest + 1
  return {
    model: pipe(
      model,
      Optic.replace(_balanceRequest)(request),
      Optic.replace(_balanceLoading)(true),
    ),
    commands: [loadBalance(request)],
  }
}

const showToast =
  (text: string) =>
  (model: TransferModel): TransferNext => {
    const id = model.nextToastId
    return {
      model: pipe(
        model,
        Optic.modify(_toasts)(Arr.append(Toast({ id, text }))),
        Optic.replace(_nextToastId)(id + 1),
      ),
      commands: [expireToast(id)],
    }
  }

/**
 * Elm's `andThen` for update steps: runs `step` on the next model and keeps the commands of
 * both steps, so chaining two steps cannot drop a command.
 */
const andThen =
  <M, Msg, R>(step: (model: M) => NextModel<M, Msg, R>) =>
  (next: NextModel<M, Msg, R>): NextModel<M, Msg, R> => {
    const after = step(next.model)
    return { model: after.model, commands: [...next.commands, ...after.commands] }
  }

const removeToast = (model: TransferModel, id: number): TransferNext =>
  model.toasts.some((toast) => toast.id === id)
    ? { model: Optic.modify(_toasts)(Arr.filter((toast) => toast.id !== id))(model), commands: [] }
    : { model, commands: [] }

const idle = Optic.replace(_transfer)(TransferState.Idle())

export const update: Update<TransferModel, TransferMsg, Ledger> = (msg, model) =>
  TransferMsg.$match(msg, {
    // One transfer at a time: a request while another runs is ignored.
    TransferRequested: ({ to, amount }) =>
      model.transfer._tag === 'Idle'
        ? {
            model: Optic.replace(_transfer)(TransferState.Submitting())(model),
            commands: [submit(to, amount)],
          }
        : { model, commands: [] },

    Submitted: ({ id }) => ({
      model: Optic.replace(_transfer)(TransferState.Pending({ id }))(model),
      commands: [],
    }),

    SubmitFailed: ({ error }) => pipe(model, idle, showToast(`Transfer failed: ${error}`)),

    Settled: ({ id }) =>
      model.transfer._tag === 'Pending' && model.transfer.id === id
        ? pipe(model, idle, showToast('Transfer settled'), andThen(requestBalance))
        : { model, commands: [] },

    BalanceRequested: () => requestBalance(model),

    BalanceLoaded: ({ request, balance }) =>
      request === model.balanceRequest
        ? {
            model: pipe(
              model,
              Optic.replace(_balance)(balance),
              Optic.replace(_balanceLoading)(false),
            ),
            commands: [],
          }
        : { model, commands: [] },

    BalanceFailed: ({ request, error }) =>
      request === model.balanceRequest
        ? pipe(model, Optic.replace(_balanceLoading)(false), showToast(`Balance failed: ${error}`))
        : { model, commands: [] },

    ToastDismissed: ({ id }) => removeToast(model, id),

    ToastExpired: ({ id }) => removeToast(model, id),
  })
