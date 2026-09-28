import type { Command, NextModel, Update } from '@roughmagic/oak'
import { Effect, pipe } from 'effect'
import { DeskMsg } from './message'
import type { DeskModel, RefreshResult, TaskStatus } from './model'
import { DeskApi } from './service'

const refreshDesk = (model: DeskModel): Command<DeskMsg, DeskApi> =>
  Effect.flatMap(DeskApi, (api) => api.refresh(model)).pipe(
    Effect.match({
      onFailure: (error) => DeskMsg.RefreshFailed({ message: error.message }),
      onSuccess: (result) => DeskMsg.RefreshSucceeded({ result }),
    }),
  )

// Each helper takes its arguments first and the model last, so the helpers compose with pipe.

const addActivity =
  (message: string, at: string) =>
  (model: DeskModel): DeskModel => ({
    ...model,
    activity: [{ id: model.nextActivityId, message, at }, ...model.activity].slice(0, 6),
    nextActivityId: model.nextActivityId + 1,
  })

const setTaskStatus =
  (id: string, status: TaskStatus) =>
  (model: DeskModel): DeskModel => ({
    ...model,
    tasks: model.tasks.map((task) => (task.id === id ? { ...task, status } : task)),
  })

const applyRefreshResult =
  (result: RefreshResult) =>
  (model: DeskModel): DeskModel => ({
    ...model,
    tasks: model.tasks.map((task) =>
      task.id === result.priorityBumpTaskId && task.status !== 'done'
        ? { ...task, priority: Math.min(task.priority + 1, 5) }
        : task,
    ),
    refresh: { ...model.refresh, pending: false, error: null },
  })

const requestRefresh = (
  model: DeskModel,
  countTick: boolean,
): NextModel<DeskModel, DeskMsg, DeskApi> => {
  // One refresh at a time.
  if (model.refresh.pending) {
    return { model, commands: [] }
  }
  const next: DeskModel = {
    ...model,
    refresh: {
      ...model.refresh,
      pending: true,
      ticks: countTick ? model.refresh.ticks + 1 : model.refresh.ticks,
      error: null,
    },
  }
  return { model: next, commands: [refreshDesk(next)] }
}

export const update: Update<DeskModel, DeskMsg, DeskApi> = (msg, model) =>
  DeskMsg.$match(msg, {
    SelectTask: ({ id }) => ({ model: { ...model, selectedTaskId: id }, commands: [] }),
    SetFilter: ({ filter }) => ({ model: { ...model, filter }, commands: [] }),
    SetTaskStatus: ({ id, status, at }) => ({
      model: pipe(
        model,
        setTaskStatus(id, status),
        addActivity(`Marked task ${id} as ${status}`, at),
      ),
      commands: [],
    }),
    ToggleAutoRefresh: () => ({
      model: { ...model, refresh: { ...model.refresh, enabled: !model.refresh.enabled } },
      commands: [],
    }),
    RefreshRequested: () => requestRefresh(model, false),
    // The subscription stops when auto-refresh turns off, but a tick can still be on its way.
    RefreshTick: () =>
      model.refresh.enabled ? requestRefresh(model, true) : { model, commands: [] },
    RefreshSucceeded: ({ result }) => ({
      model: pipe(
        model,
        applyRefreshResult(result),
        addActivity(result.activityMessage, result.at),
      ),
      commands: [],
    }),
    RefreshFailed: ({ message }) => ({
      model: { ...model, refresh: { ...model.refresh, pending: false, error: message } },
      commands: [],
    }),
  })
