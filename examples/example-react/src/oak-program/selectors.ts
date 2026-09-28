import * as Optic from '@fp-ts/optic'
import { dieIds, type DiceModel, type DieId } from './model.js'
import * as o from './optics.js'

export const selectDie = (id: DieId) => Optic.get(o.die(id))

export const selectAutoRoll = Optic.get(o.autoRoll)

export const selectDiceSum = (model: DiceModel): number =>
  dieIds.reduce((sum, id) => sum + selectDie(id)(model).value, 0)
