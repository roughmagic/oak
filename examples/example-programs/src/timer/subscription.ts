import type { Subscriptions } from '@roughmagic/oak'
import { Effect, Stream } from 'effect'
import type { TimerModel } from './model.js'
import { TimerMsg } from './message.js'

/**
 * One ticker. The stream reads only `intervalMs`, so the key names only `intervalMs`: a new
 * interval stops the old ticker and starts a new one.
 */
export const subscriptions: Subscriptions<TimerModel, TimerMsg> = (model) => [
  {
    key: `tick:${model.intervalMs}`,
    stream: Stream.repeatEffect(Effect.as(Effect.sleep(model.intervalMs), TimerMsg.Tick())),
  },
]
