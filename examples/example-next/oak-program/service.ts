import { Clock, Context, Effect, Layer } from 'effect'
import type { DeskModel, RefreshResult } from './model'

export interface DeskApi {
  readonly refresh: (model: DeskModel) => Effect.Effect<RefreshResult, Error>
}

export const DeskApi = Context.GenericTag<DeskApi>('@roughmagic/example-next/DeskApi')

// A stand-in for a fetch to a Route Handler. It waits like a network call and never fails.
export const DeskApiLive: Layer.Layer<DeskApi> = Layer.succeed(
  DeskApi,
  DeskApi.of({
    refresh: (model) =>
      Effect.gen(function* () {
        yield* Effect.sleep('450 millis')
        const now = yield* Clock.currentTimeMillis
        const openTask = model.tasks.find((task) => task.status !== 'done')
        return {
          at: new Date(now).toISOString(),
          activityMessage: openTask
            ? `Server refresh checked ${openTask.title}`
            : 'Server refresh found no open work',
          priorityBumpTaskId: openTask?.id ?? null,
        }
      }),
  }),
)
