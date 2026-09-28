import { createSelector } from 'reselect'
import type { DeskModel, DeskTask } from './model'

// A selector that returns a value already in the model needs no memoizing: the value keeps its
// reference until update replaces it.

const selectTasks = (model: DeskModel): readonly DeskTask[] => model.tasks

export const selectSelectedTask = (model: DeskModel): DeskTask | null =>
  model.tasks.find((task) => task.id === model.selectedTaskId) ?? null

// A selector that builds a new array or object needs createSelector. Without it, the component
// re-renders on every model change, because each call returns a new reference.

export const selectVisibleTasks = createSelector(
  [selectTasks, (model: DeskModel) => model.filter],
  (tasks, filter) => (filter === 'all' ? tasks : tasks.filter((task) => task.status === filter)),
)

export const selectSummary = createSelector([selectTasks], (tasks) => ({
  total: tasks.length,
  open: tasks.filter((task) => task.status === 'open').length,
  blocked: tasks.filter((task) => task.status === 'blocked').length,
  done: tasks.filter((task) => task.status === 'done').length,
}))
