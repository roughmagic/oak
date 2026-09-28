import { makeProgram } from '@roughmagic/oak'
import { initialModel } from './model.js'
import { subscriptions } from './subscription.js'
import { update } from './update.js'

export const DiceProgram = makeProgram('@roughmagic/example-react/Dice', {
  init: { model: initialModel, commands: [] },
  update,
  subscriptions,
})
