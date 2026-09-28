import { getItem, type ItemKey, type ItemModel } from './model.js'

export const selectItem = (key: ItemKey) => (model: ItemModel) => getItem(model, key)
