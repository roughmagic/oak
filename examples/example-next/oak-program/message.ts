import { Data } from 'effect'
import type { DeskFilter, RefreshResult, TaskStatus } from './model'

export type DeskMsg = Data.TaggedEnum<{
  SelectTask: { readonly id: string }
  SetFilter: { readonly filter: DeskFilter }
  // `at` comes from the event handler, so update never reads the clock.
  SetTaskStatus: { readonly id: string; readonly status: TaskStatus; readonly at: string }
  ToggleAutoRefresh: {}
  RefreshRequested: {}
  RefreshTick: {}
  RefreshSucceeded: { readonly result: RefreshResult }
  RefreshFailed: { readonly message: string }
}>

export const DeskMsg = Data.taggedEnum<DeskMsg>()
