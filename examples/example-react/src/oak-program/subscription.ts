import { Effect, Stream } from 'effect'
import type { Subscriptions } from '@roughmagic/oak'
import { DiceMsg } from './message.js'
import type { DiceModel } from './model.js'

export const subscriptions: Subscriptions<DiceModel, DiceMsg> = ({ autoRoll }) =>
  autoRoll.enabled
    ? [
        {
          key: `autoRoll:${autoRoll.intervalMs}`,
          stream: Stream.repeatEffect(
            Effect.as(Effect.sleep(autoRoll.intervalMs), DiceMsg.AutoRollTick()),
          ),
        },
      ]
    : []
