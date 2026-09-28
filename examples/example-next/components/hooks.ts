import { createOakHooks } from '@roughmagic/oak-react'
import type { DeskMsg } from '@/oak-program/message'
import type { DeskModel } from '@/oak-program/model'

export const { useSelector, useDispatch } = createOakHooks<DeskModel, DeskMsg>()
