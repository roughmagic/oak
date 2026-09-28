import { makeProgram } from '@roughmagic/oak'
import { initialModel } from './model.js'
import { subscriptions } from './subscription.js'
import { update } from './update.js'

export { TimerMsg } from './message.js'
export { TimerModel, initialModel } from './model.js'
export { subscriptions } from './subscription.js'
export { update } from './update.js'

export const TimerProgram = makeProgram('@roughmagic/example-programs/Timer', {
  init: { model: initialModel, commands: [] },
  update,
  subscriptions,
})
