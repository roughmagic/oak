import * as Optic from '@fp-ts/optic'
import type { Command, Update } from '@roughmagic/oak'
import { Effect, Random } from 'effect'
import { caseIso } from '../optic.js'
import { RandomModel } from './model.js'
import { RandomMsg } from './message.js'

const _pending = caseIso(RandomModel).at('pending')

// Effect's Random service rather than Math.random, so a test can fix the number. The upper
// bound is exclusive: this picks 1 to 100.
const fetchNumber: Command<RandomMsg> = Effect.sleep('2 seconds').pipe(
  Effect.zipRight(Random.nextIntBetween(1, 101)),
  Effect.map((value) => RandomMsg.Set({ value })),
)

export const update: Update<RandomModel, RandomMsg> = (msg, model) =>
  RandomMsg.$match(msg, {
    Fetch: () => ({ model: Optic.replace(_pending)(true)(model), commands: [fetchNumber] }),
    Set: ({ value }) => ({ model: RandomModel({ pending: false, value }), commands: [] }),
  })
