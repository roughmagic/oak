import * as Optic from '@fp-ts/optic'
import type { Update } from '@roughmagic/oak'
import { caseIso } from '../optic.js'
import { CounterModel } from './model.js'
import { CounterMsg } from './message.js'

const _count = caseIso(CounterModel).at('count')

export const update: Update<CounterModel, CounterMsg> = (msg, model) =>
  CounterMsg.$match(msg, {
    Increment: () => ({ model: Optic.modify(_count)((n) => n + 1)(model), commands: [] }),
    Decrement: () => ({ model: Optic.modify(_count)((n) => n - 1)(model), commands: [] }),
  })
