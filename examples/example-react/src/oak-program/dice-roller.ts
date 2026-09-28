import { Context, Layer, Random, type Effect } from 'effect'

export interface DiceRoller {
  readonly roll: Effect.Effect<number>
}

export const DiceRoller = Context.GenericTag<DiceRoller>('@roughmagic/example-react/DiceRoller')

export const DiceRollerLive: Layer.Layer<DiceRoller> = Layer.succeed(DiceRoller, {
  // The upper bound is exclusive: this rolls 1 to 6.
  roll: Random.nextIntBetween(1, 7),
})
