import { makeProgram } from '@roughmagic/oak'
import { initialModel } from './model.js'
import { update } from './update.js'

export const ItemProgram = makeProgram('@roughmagic/example-remote-data/Item', {
  init: { model: initialModel, effects: [] },
  update,
})
