import { makeProgram } from '@roughmagic/oak'
import type { DeskModel } from './model'
import { subscriptions } from './subscription'
import { update } from './update'

/** The server seed is the first model, so each page mount makes its own program. */
export const makeDeskProgram = (model: DeskModel) =>
  makeProgram('@roughmagic/example-next/Desk', {
    init: { model, effects: [] },
    update,
    subscriptions,
  })
