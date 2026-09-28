import { makeProgram } from '@roughmagic/oak'
import { initialModel } from './model.js'
import { update } from './update.js'

export { RandomMsg } from './message.js'
export { RandomModel, initialModel } from './model.js'
export { update } from './update.js'

export const RandomProgram = makeProgram('@roughmagic/example-programs/Random', {
  init: { model: initialModel, effects: [] },
  update,
})
