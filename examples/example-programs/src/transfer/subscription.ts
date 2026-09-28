import type { Subscriptions } from '@roughmagic/oak'
import { Effect, Schedule, Stream } from 'effect'
import { Ledger, type TransferId } from './ledger.js'
import { TransferMsg } from './message.js'
import type { TransferModel } from './model.js'

/** Polls the transfer's status once a second and emits Settled once, when it has settled. */
const watch = (id: TransferId): Stream.Stream<TransferMsg, never, Ledger> =>
  Stream.repeatEffectWithSchedule(
    Effect.flatMap(Ledger, (ledger) => ledger.status(id)).pipe(
      // A failed poll counts as pending: the next poll asks again.
      Effect.orElseSucceed(() => 'pending' as const),
    ),
    Schedule.spaced('1 second'),
  ).pipe(
    Stream.filter((status) => status === 'settled'),
    Stream.take(1),
    Stream.as(TransferMsg.Settled({ id })),
  )

/** The watch stream reads only the transfer id, so the key names only the id. */
export const subscriptions: Subscriptions<TransferModel, TransferMsg, Ledger> = (model) =>
  model.transfer._tag === 'Pending'
    ? [{ key: `watch:${model.transfer.id}`, stream: watch(model.transfer.id) }]
    : []
