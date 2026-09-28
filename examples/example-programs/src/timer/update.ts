import * as Optic from '@fp-ts/optic'
import type { Update } from '@roughmagic/oak'
import { caseIso } from '../optic.js'
import { TimerModel } from './model.js'
import { TimerMsg } from './message.js'

const _ticks = caseIso(TimerModel).at('ticks')
const _intervalMs = caseIso(TimerModel).at('intervalMs')

export const update: Update<TimerModel, TimerMsg> = (msg, model) =>
  TimerMsg.$match(msg, {
    Tick: () => ({ model: Optic.modify(_ticks)((n) => n + 1)(model), effects: [] }),
    Reset: () => ({ model: Optic.replace(_ticks)(0)(model), effects: [] }),
    SetInterval: ({ ms }) => ({ model: Optic.replace(_intervalMs)(ms)(model), effects: [] }),
  })
