import * as Optic from '@fp-ts/optic'
import { identity } from 'effect'
import { AutoRollState, Dice, DiceModel, DieState, type DieId } from './model.js'

/**
 * Optic's `at` copies a value into a plain object, which drops the structural equality of
 * `Data.case`. This iso passes each copy back through the constructor.
 */
const caseIso = <A>(make: (fields: A) => A): Optic.Iso<A, A> => Optic.iso(identity, make)

// A lens composes caseIso at each Data.case value on its path, so every level of an updated
// model still compares by value with Equal.equals.
const model = caseIso(DiceModel)
const dice = model.at('dice').compose(caseIso(Dice))

export const die = (id: DieId) => dice.at(id).compose(caseIso(DieState))
export const autoRoll = model.at('autoRoll').compose(caseIso(AutoRollState))
