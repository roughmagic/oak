import * as Optic from '@fp-ts/optic'
import type { Command, Update } from '@roughmagic/oak'
import { Effect, pipe } from 'effect'
import { caseIso } from '../optic.js'
import { JokeModel } from './model.js'
import { JokeMsg } from './message.js'
import { JokeService } from './service.js'

const _pending = caseIso(JokeModel).at('pending')
const _error = caseIso(JokeModel).at('error')

// The service can fail with a JokeFetchError. The command turns that failure into a message,
// so the model can show it.
const fetchJoke: Command<JokeMsg, JokeService> = Effect.flatMap(
  JokeService,
  (service) => service.fetchJoke,
).pipe(
  Effect.match({
    onSuccess: (joke) => JokeMsg.Got({ joke }),
    onFailure: (error) => JokeMsg.Failed({ error: error.message }),
  }),
)

export const update: Update<JokeModel, JokeMsg, JokeService> = (msg, model) =>
  JokeMsg.$match(msg, {
    Fetch: () => ({
      model: pipe(model, Optic.replace(_pending)(true), Optic.replace(_error)(null)),
      effects: [fetchJoke],
    }),
    Got: ({ joke }) => ({ model: JokeModel({ pending: false, joke, error: null }), effects: [] }),
    Failed: ({ error }) => ({
      model: pipe(model, Optic.replace(_pending)(false), Optic.replace(_error)(error)),
      effects: [],
    }),
  })
