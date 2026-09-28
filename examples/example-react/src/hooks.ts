import { createOakHooks } from '@roughmagic/oak-react'
import type { DiceModel, DiceMsg } from './oak-program/index.js'

export const { useSelector, useDispatch } = createOakHooks<DiceModel, DiceMsg>()
