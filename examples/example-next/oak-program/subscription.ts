import { Effect, Stream } from 'effect'
import type { Subscriptions } from '@roughmagic/oak'
import { DeskMsg } from './message'
import type { DeskModel } from './model'

export const subscriptions: Subscriptions<DeskModel, DeskMsg> = ({ refresh }) =>
  refresh.enabled
    ? [
        {
          // The stream reads intervalMs, so the key names it: a new interval restarts the stream.
          key: `refresh:${refresh.intervalMs}`,
          stream: Stream.repeatEffect(
            Effect.as(Effect.sleep(refresh.intervalMs), DeskMsg.RefreshTick()),
          ),
        },
      ]
    : []
