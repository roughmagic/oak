import { makeProgram } from '@roughmagic/oak'
import { initialModel } from './model.js'
import { update } from './update.js'

export { JokeMsg } from './message.js'
export { JokeModel, initialModel } from './model.js'
export { JokeFetchError, JokeService, JokeServiceFake, JokeServiceLive } from './service.js'
export { update } from './update.js'

export const JokeProgram = makeProgram('@roughmagic/example-programs/Joke', {
  init: { model: initialModel, commands: [] },
  update,
})
