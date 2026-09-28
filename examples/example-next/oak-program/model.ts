export type DeskMode = 'operations' | 'planning' | 'incident'
export type TaskStatus = 'open' | 'blocked' | 'done'
export type DeskFilter = 'all' | TaskStatus

export interface DeskTask {
  readonly id: string
  readonly title: string
  readonly status: TaskStatus
  readonly owner: string
  readonly priority: number
}

export interface ActivityItem {
  readonly id: number
  readonly message: string
  readonly at: string
}

export interface RefreshState {
  readonly enabled: boolean
  readonly intervalMs: number
  readonly pending: boolean
  readonly ticks: number
  readonly error: string | null
}

export interface DeskModel {
  readonly desk: string
  readonly mode: DeskMode
  readonly operator: string
  readonly generatedAt: string
  readonly selectedTaskId: string | null
  readonly filter: DeskFilter
  readonly refresh: RefreshState
  readonly tasks: readonly DeskTask[]
  readonly activity: readonly ActivityItem[]
  /** The id of the next activity item. The model assigns ids, so two items never share one. */
  readonly nextActivityId: number
}

export interface RefreshResult {
  readonly at: string
  readonly activityMessage: string
  readonly priorityBumpTaskId: string | null
}
