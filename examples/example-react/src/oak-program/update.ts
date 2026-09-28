import * as Optic from '@fp-ts/optic'
import type { Command, NextModel, Update } from '@roughmagic/oak'
import { Effect } from 'effect'
import { DiceRoller } from './dice-roller.js'
import { DiceMsg } from './message.js'
import { dieIds, DieState, type DiceModel, type DieId } from './model.js'
import * as o from './optics.js'

// The delay keeps the rolling state on screen long enough to see.
const rollDie = (die: DieId): Command<DiceMsg, DiceRoller> =>
  Effect.flatMap(DiceRoller, (roller) => roller.roll).pipe(
    Effect.delay('650 millis'),
    Effect.map((value) => DiceMsg.Rolled({ die, value })),
  )

const rolling = (die: DieId) => o.die(die).at('rolling')
const autoRollEnabled = o.autoRoll.at('enabled')

const isRolling = (die: DieId) => Optic.get(rolling(die))
const startRolling = (die: DieId) => Optic.replace(rolling(die))(true)
const land = (die: DieId, value: number) =>
  Optic.replace(o.die(die))(DieState({ value, rolling: false }))
const toggleAutoRoll = Optic.modify(autoRollEnabled)((enabled) => !enabled)
const countTick = Optic.modify(o.autoRoll.at('ticks'))((ticks) => ticks + 1)

// A die that is already rolling keeps its roll, so a die never has two rolls in flight.
const roll =
  (dice: ReadonlyArray<DieId>) =>
  (model: DiceModel): NextModel<DiceModel, DiceMsg, DiceRoller> => {
    const ready = dice.filter((die) => !isRolling(die)(model))
    return {
      model: ready.reduce((next, die) => startRolling(die)(next), model),
      commands: ready.map(rollDie),
    }
  }

export const update: Update<DiceModel, DiceMsg, DiceRoller> = (msg, model) =>
  DiceMsg.$match(msg, {
    Roll: ({ die }) => roll([die])(model),
    RollAll: () => roll(dieIds)(model),
    ToggleAutoRoll: () => ({ model: toggleAutoRoll(model), commands: [] }),
    // A tick can arrive after auto-roll stops.
    AutoRollTick: () =>
      Optic.get(autoRollEnabled)(model) ? roll(dieIds)(countTick(model)) : { model, commands: [] },
    Rolled: ({ die, value }) => ({ model: land(die, value)(model), commands: [] }),
  })
