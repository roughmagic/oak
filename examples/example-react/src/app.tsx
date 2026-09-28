import { OakProvider } from '@roughmagic/oak-react'
import { useDispatch, useSelector } from './hooks.js'
import {
  DiceMsg,
  DiceProgram,
  dieIds,
  selectAutoRoll,
  selectDiceSum,
  selectDie,
  type DieId,
} from './oak-program/index.js'
import { appRuntime } from './runtime.js'

function DieRoller({ label, die }: { readonly label: string; readonly die: DieId }) {
  const { value, rolling } = useSelector(selectDie(die))
  const dispatch = useDispatch()

  return (
    <article>
      <h2>{label}</h2>
      <output aria-label={`${label} value`}>{rolling ? 'rolling...' : value}</output>
      <button type="button" disabled={rolling} onClick={() => dispatch(DiceMsg.Roll({ die }))}>
        {rolling ? 'Rolling...' : `Roll ${label}`}
      </button>
    </article>
  )
}

function AutoRollPanel() {
  const autoRoll = useSelector(selectAutoRoll)
  const dispatch = useDispatch()
  const intervalSeconds = autoRoll.intervalMs / 1_000

  return (
    <section aria-label="Auto-roll">
      <h2>Auto-roll</h2>
      <p>
        {autoRoll.enabled ? `Every ${intervalSeconds}s` : 'Stopped'} - ticks:{' '}
        <strong>{autoRoll.ticks}</strong>
      </p>
      <button type="button" onClick={() => dispatch(DiceMsg.ToggleAutoRoll())}>
        {autoRoll.enabled ? 'Stop auto-roll' : 'Start auto-roll'}
      </button>
      <button type="button" onClick={() => dispatch(DiceMsg.RollAll())}>
        Roll all now
      </button>
    </section>
  )
}

function DicePanel() {
  const total = useSelector(selectDiceSum)

  return (
    <section>
      <h1>Oak dice program</h1>
      <div>
        {dieIds.map((die, i) => (
          <DieRoller key={die} label={`Die ${i + 1}`} die={die} />
        ))}
      </div>
      <AutoRollPanel />
      <p>
        Total: <strong>{total}</strong>
      </p>
    </section>
  )
}

export function App() {
  return (
    <OakProvider runtime={appRuntime} program={DiceProgram}>
      <DicePanel />
    </OakProvider>
  )
}
