import Link from 'next/link'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { useTransition, type ReactElement } from 'react'
import type { DeskSeed } from '@/lib/server-seed'
import {
  DeskMsg,
  selectSelectedTask,
  selectSummary,
  selectVisibleTasks,
  type DeskTask,
} from '@/oak-program'
import { useDispatch, useSelector } from './hooks'

const filters = ['all', 'open', 'blocked', 'done'] as const
const statuses = ['open', 'blocked', 'done'] as const

// The server and the browser can be in different time zones. A fixed locale and zone render the
// same text in both, so hydration matches.
const timeFormat = new Intl.DateTimeFormat('en-US', { timeStyle: 'medium', timeZone: 'UTC' })
const formatTime = (iso: string): string => `${timeFormat.format(new Date(iso))} UTC`

// Each component selects only what it renders, so a message re-renders only the panels whose
// data changed.

export function DeskView({ seed }: { readonly seed: DeskSeed }): ReactElement {
  return (
    <div className="desk">
      <HeaderPanel seed={seed} />
      <SummaryPanel />
      <div className="grid">
        <section className="panel">
          <header className="toolbar">
            <h2>Work queue</h2>
            <RefreshButtons />
          </header>
          <FilterBar />
          <TaskList />
        </section>
        <aside className="panel">
          <h2>Runtime state</h2>
          <SelectedTask />
          <RefreshStatus />
          <ActivityList />
        </aside>
      </div>
    </div>
  )
}

function HeaderPanel({ seed }: { readonly seed: DeskSeed }): ReactElement {
  const desk = useSelector((model) => model.desk)
  const mode = useSelector((model) => model.mode)
  const operator = useSelector((model) => model.operator)
  const generatedAt = useSelector((model) => model.generatedAt)
  const ticks = useSelector((model) => model.refresh.ticks)
  const router = useRouter()
  const [isNavigating, startNavigation] = useTransition()

  const navigateToIncident = () => {
    startNavigation(() => {
      router.push('/desks/launch?mode=incident&operator=Riley')
    })
  }

  return (
    <section className="hero">
      <div>
        <h1>{desk}</h1>
        <p>
          Server seed <code>{seed.seedKey}</code> initialized this Oak program for {operator}.
        </p>
      </div>
      <div className="hero-meta">
        <span>Mode: {mode}</span>
        <span>Generated: {formatTime(generatedAt)}</span>
        <span>Refreshes: {ticks}</span>
      </div>
      <nav className="nav" aria-label="Server-seeded routes">
        {seed.navigation.map((item) => (
          <Link key={item.href} href={item.href as Route}>
            {item.label}
          </Link>
        ))}
        <button type="button" disabled={isNavigating} onClick={navigateToIncident}>
          {isNavigating ? 'Navigating' : 'Router push incident'}
        </button>
      </nav>
    </section>
  )
}

function SummaryPanel(): ReactElement {
  const summary = useSelector(selectSummary)
  return (
    <section className="panel">
      <h2>Server initialized model</h2>
      <div className="metrics">
        <span className="metric">Total {summary.total}</span>
        <span className="metric">Open {summary.open}</span>
        <span className="metric">Blocked {summary.blocked}</span>
        <span className="metric">Done {summary.done}</span>
      </div>
    </section>
  )
}

function RefreshButtons(): ReactElement {
  const pending = useSelector((model) => model.refresh.pending)
  const enabled = useSelector((model) => model.refresh.enabled)
  const dispatch = useDispatch()
  return (
    <>
      <button type="button" disabled={pending} onClick={() => dispatch(DeskMsg.RefreshRequested())}>
        {pending ? 'Refreshing' : 'Refresh via Effect'}
      </button>
      <button type="button" onClick={() => dispatch(DeskMsg.ToggleAutoRefresh())}>
        {enabled ? 'Stop auto-refresh' : 'Start auto-refresh'}
      </button>
    </>
  )
}

function FilterBar(): ReactElement {
  const filter = useSelector((model) => model.filter)
  const dispatch = useDispatch()
  return (
    <div className="toolbar" aria-label="Task filters">
      {filters.map((value) => (
        <button
          key={value}
          type="button"
          disabled={filter === value}
          onClick={() => dispatch(DeskMsg.SetFilter({ filter: value }))}
        >
          {value}
        </button>
      ))}
    </div>
  )
}

function TaskList(): ReactElement {
  const tasks = useSelector(selectVisibleTasks)
  const selectedTaskId = useSelector((model) => model.selectedTaskId)
  return (
    <div className="task-list">
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} selected={task.id === selectedTaskId} />
      ))}
    </div>
  )
}

function TaskCard({
  task,
  selected,
}: {
  readonly task: DeskTask
  readonly selected: boolean
}): ReactElement {
  const dispatch = useDispatch()
  return (
    <article className="task">
      <header>
        <h3>{task.title}</h3>
        <span className={`status ${task.status}`}>{task.status}</span>
      </header>
      <p>
        Owner {task.owner} - priority {task.priority}
      </p>
      <footer>
        <button type="button" onClick={() => dispatch(DeskMsg.SelectTask({ id: task.id }))}>
          {selected ? 'Selected' : 'Inspect'}
        </button>
        <div className="toolbar" aria-label="Set task status">
          {statuses.map((status) => (
            <button
              key={status}
              type="button"
              disabled={task.status === status}
              // The event handler reads the clock, so update stays pure.
              onClick={() =>
                dispatch(
                  DeskMsg.SetTaskStatus({ id: task.id, status, at: new Date().toISOString() }),
                )
              }
            >
              {status}
            </button>
          ))}
        </div>
      </footer>
    </article>
  )
}

function SelectedTask(): ReactElement {
  const task = useSelector(selectSelectedTask)
  return task === null ? (
    <p>No task selected.</p>
  ) : (
    <p>
      Inspecting {task.title}, owned by {task.owner}.
    </p>
  )
}

function RefreshStatus(): ReactElement {
  const enabled = useSelector((model) => model.refresh.enabled)
  const intervalMs = useSelector((model) => model.refresh.intervalMs)
  const error = useSelector((model) => model.refresh.error)
  return (
    <>
      <p>
        Auto-refresh {enabled ? 'enabled' : 'disabled'} every {intervalMs / 1_000}s.
      </p>
      {error === null ? null : <p role="alert">{error}</p>}
    </>
  )
}

function ActivityList(): ReactElement {
  const activity = useSelector((model) => model.activity)
  return (
    <div className="activity-list">
      {activity.map((item) => (
        <div className="activity" key={item.id}>
          <p>{item.message}</p>
          <span>{formatTime(item.at)}</span>
        </div>
      ))}
    </div>
  )
}
