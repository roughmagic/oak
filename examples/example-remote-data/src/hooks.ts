import { createOakHooks } from '@roughmagic/oak-react'
import type { ItemMsg } from './oak-program/message.js'
import type { ItemModel } from './oak-program/model.js'

export const { useSelector, useDispatch } = createOakHooks<ItemModel, ItemMsg>()
