import type { DeskMode, DeskModel, DeskTask, TaskStatus } from '@/oak-program/model'

export type RouteDesk = 'north' | 'west' | 'launch'

export interface DeskSearchParams {
  readonly mode?: string
  readonly operator?: string
}

export interface DeskSeed {
  readonly seedKey: string
  readonly initialModel: DeskModel
  readonly navigation: ReadonlyArray<{
    readonly label: string
    readonly href: string
  }>
}

export function coerceDesk(value: string): RouteDesk {
  if (value === 'west' || value === 'launch') return value
  return 'north'
}

function coerceMode(value: string | undefined): DeskMode {
  if (value === 'planning' || value === 'incident') return value
  return 'operations'
}

function operatorName(value: string | undefined, desk: RouteDesk): string {
  if (value && value.trim().length > 0) return value.trim().slice(0, 32)

  switch (desk) {
    case 'north':
      return 'Mira Chen'
    case 'west':
      return 'Tomas Hale'
    case 'launch':
      return 'Avery Singh'
  }
}

function deskLabel(desk: RouteDesk): string {
  switch (desk) {
    case 'north':
      return 'North Fulfillment'
    case 'west':
      return 'West Marketplace'
    case 'launch':
      return 'Launch Control'
  }
}

function task(
  id: string,
  title: string,
  status: TaskStatus,
  owner: string,
  priority: number,
): DeskTask {
  return { id, title, status, owner, priority }
}

function tasksFor(desk: RouteDesk, mode: DeskMode): readonly DeskTask[] {
  const shared = [
    task('customer-latency', 'Review high-latency customer accounts', 'open', 'Support', 3),
    task('billing-sync', 'Confirm billing sync window', 'done', 'Finance', 2),
  ] as const

  if (mode === 'incident') {
    return [
      task('incident-bridge', 'Keep incident bridge staffed', 'open', 'Ops', 5),
      task('status-page', 'Update external status page', 'blocked', 'Comms', 4),
      ...shared,
    ]
  }

  if (desk === 'launch') {
    return [
      task('cutover-checklist', 'Finish launch cutover checklist', 'open', 'Release', 5),
      task('partner-smoke', 'Run partner smoke tests', 'blocked', 'QA', 4),
      ...shared,
    ]
  }

  if (desk === 'west') {
    return [
      task('catalog-review', 'Review regional catalog exceptions', 'open', 'Catalog', 4),
      task('capacity-plan', 'Publish capacity plan', 'open', 'Planning', 3),
      ...shared,
    ]
  }

  return [
    task('dock-forecast', 'Compare dock forecast against inbound load', 'open', 'Ops', 4),
    task('carrier-risk', 'Escalate carrier risk review', 'blocked', 'Logistics', 5),
    ...shared,
  ]
}

// Async like a real loader, which would read a database or an API here.
export async function loadDeskSeed({
  desk,
  searchParams,
}: {
  readonly desk: RouteDesk
  readonly searchParams: DeskSearchParams
}): Promise<DeskSeed> {
  const mode = coerceMode(searchParams.mode)
  const generatedAt = new Date().toISOString()
  const operator = operatorName(searchParams.operator, desk)
  const tasks = tasksFor(desk, mode)
  const selectedTaskId = tasks[0]?.id ?? null

  return {
    seedKey: `${desk}:${mode}:${operator}`,
    initialModel: {
      desk: deskLabel(desk),
      mode,
      operator,
      generatedAt,
      selectedTaskId,
      filter: 'all',
      refresh: {
        enabled: false,
        intervalMs: mode === 'incident' ? 4_000 : 7_000,
        pending: false,
        ticks: 0,
        error: null,
      },
      tasks,
      activity: [{ id: 0, message: `Server seed loaded for ${deskLabel(desk)}`, at: generatedAt }],
      nextActivityId: 1,
    },
    navigation: [
      { label: 'North operations', href: '/' },
      { label: 'North incident', href: '/desks/north?mode=incident' },
      { label: 'West planning', href: '/desks/west?mode=planning' },
      { label: 'Launch incident', href: '/desks/launch?mode=incident' },
    ],
  }
}
