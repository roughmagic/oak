import { makeProgram } from '@roughmagic/oak'
import { initialModel } from './model.js'
import { update } from './update.js'

export { CounterMsg } from './message.js'
export { CounterModel, initialModel } from './model.js'
export { update } from './update.js'

export const CounterProgram = makeProgram('@roughmagic/example-programs/Counter', {
  init: { model: initialModel, commands: [] },
  update,
})
