// subscription.ts: Elm's `subscriptions`, built on Effect streams.
//
// A model asks for streams through `subscriptions(model)`. Each call can build new Stream
// values, so Oak cannot tell by value that a stream from one call is the same subscription as a
// stream from the next. A string key names each subscription instead.
//
// The reconcile loop watches the model. After a change, it starts a stream for each new key and
// interrupts the stream of each key that left. Each message that a stream emits reaches `update`
// through `deliver`, in its own dispatch.
//
// Place in Oak: program.ts forks the reconcile loop once each time the program's layer builds,
// and supplies `spawn` and `deliver`. The loop reads the model through the kernel's `state`.

import { Effect, Fiber, Stream, type Scope } from 'effect'
import { logDefect } from './defect.js'
import type { OakState } from './types.js'

// ---- Public types -------------------------------------------------------------------------------

/**
 * A stream of messages that runs while its key is in `subscriptions(model)`.
 *
 * The key names every model value the stream reads, and nothing else. Oak runs only the stream
 * from the call where its key first appeared. A value missing from the key goes stale; a value
 * in the key restarts the stream when it changes.
 *
 * Lifecycle:
 * - Equal keys are one subscription. Oak runs it once.
 * - Each run has its own `Scope`, closed when the run ends.
 * - A stream that completes keeps its key. It runs again only after the key leaves and comes
 *   back.
 * - Oak interrupts a stream silently when its key leaves and when the program's scope closes.
 * - A stream that dies is a defect. So is a stream that ends by an interruption from its own
 *   work while its key is wanted and the program runs. Oak logs the defect, and the stream stays
 *   stopped until its key leaves and comes back.
 * - A key that comes back starts its new stream after the previous run has finished,
 *   finalizers included.
 * - Oak reconciles against the latest model only, so a key that leaves and returns before Oak
 *   reconciles does not restart its stream. To restart on demand, put a counter in the key.
 * - A message can arrive after its key has left. `update` must accept messages for things that
 *   are gone.
 */
export interface Subscription<Msg, R = never> {
  /** The subscription's identity. Oak compares keys, never streams. */
  readonly key: string

  /**
   * The messages to dispatch, one dispatch each. The error type is `never`: turn failures into
   * messages, as a command does.
   */
  readonly stream: Stream.Stream<Msg, never, R>
}

/**
 * Elm's `subscriptions`: the streams that a model asks for.
 *
 * Oak calls it with the latest model when the program starts and after the model changes. A
 * model that a newer one replaces before Oak reconciles is skipped. If it throws, the throw is
 * logged and the running streams are left alone.
 */
export type Subscriptions<M, Msg, R = never> = (model: M) => ReadonlyArray<Subscription<Msg, R>>

// ---- The model as a stream ----------------------------------------------------------------------

// A Stream of models: the current model first, then each new model.
//
// The first emit and the subscribe run in one synchronous block. No dispatch can run between
// them, so the stream misses no change.
//
// The kernel calls the listener inside `dispatch`. The listener only pushes the model into the
// stream's buffer. The reconcile loop takes it later, on Effect's scheduler, never inside the
// dispatch.
//
// The sliding buffer keeps only the latest model, which is all reconciliation needs. A newer
// model replaces one that the loop has not taken yet. The default strategy, 'dropping', would
// keep the older model and lose the newest.
//
// acquireRelease removes the listener when the stream ends. That happens when the program's
// scope closes and interrupts the reconcile loop.
const stateStream = <M>(state: OakState<M>): Stream.Stream<M> =>
  Stream.asyncPush<M>(
    (emit) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          emit.single(state.value)
          return state.subscribe((model) => {
            emit.single(model)
          })
        }),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    { bufferSize: 1, strategy: 'sliding' },
  )

// ---- The reconcile loop -------------------------------------------------------------------------

// One run of one subscription's stream.
interface Run {
  // The fiber that runs the stream. The Run stays in the map after the fiber ends, so a
  // completed or dead stream keeps its key claimed and does not start again.
  readonly fiber: Fiber.RuntimeFiber<void>

  // True while the key is in the latest `subscriptions(model)`. reconcile sets it to false when
  // it retires the run. It never turns true again: a returning key gets a new Run.
  wanted: boolean
}

/**
 * Runs the reconcile loop. For each new model it starts a run for each key that appeared and
 * retires the run of each key that left. The returned effect runs until it is interrupted.
 * program.ts forks it once, when the program's layer builds.
 *
 * - `program` is the program's key, for defect logs.
 * - `state` is the kernel's model and listener set.
 * - `deliver` dispatches one message from a stream.
 * - `spawn` forks a run on the program's runtime, into the program's fiber set. It treats an
 *   interruption as silent when `retired()` is true. The runs are not children of the loop's
 *   fiber: closing the program's scope interrupts the loop and every run.
 *
 * Not a `FiberMap`: that forgets a fiber when it completes, which would re-fork one-shot
 * streams on the next reconcile. Here a run stays claimed while its key is wanted, and a
 * retired run is kept until it has finished so that a returning key can wait for it.
 */
export function runSubscriptions<M, Msg, R>(
  program: string,
  state: OakState<M>,
  subscriptions: Subscriptions<M, Msg, R>,
  deliver: (msg: Msg) => Effect.Effect<void>,
  spawn: (
    // The program's services without `Scope`: `start` gives each run a Scope of its own.
    effect: Effect.Effect<void, never, Exclude<R, Scope.Scope>>,
    retired: () => boolean,
  ) => Fiber.RuntimeFiber<void>,
): Effect.Effect<void> {
  // The wanted run of each key, plus retired runs that may still be finishing. One fiber runs
  // the loop, one model at a time, so no two reconcile steps touch the map at once.
  const runs = new Map<string, Run>()

  // Forks a new run of `sub.stream`. `previous` is this key's retired run, if the map still
  // holds one. It may have finished already; then the wait below returns at once.
  const start = (sub: Subscription<Msg, R>, previous: Run | undefined): Run => {
    const run: Run = {
      wanted: true,
      fiber: spawn(
        Effect.gen(function* () {
          // A returning key waits for its previous run to end, finalizers included. Two runs of
          // one key never overlap, so a socket or a lock from the old run is released before
          // the new run opens its own.
          if (previous !== undefined) {
            // Uninterruptible, so an interrupted run still ends after its predecessor: a later
            // run then waits for both. If the key leaves again during the wait, the
            // interruption takes effect when the wait ends, before this run starts its stream.
            // An interruptible wait would end this run early, and the next run could overlap
            // the old one.
            yield* Effect.uninterruptible(Fiber.await(previous.fiber))
          }

          // Effect.scoped gives this run its own Scope. The Scope closes when the run ends:
          // the stream completes, dies or is interrupted.
          //
          // Stream.runForEach dispatches the elements one at a time, in stream order. deliver
          // logs a throw from `update`, so one bad message does not end the stream.
          yield* Effect.scoped(Stream.runForEach(sub.stream, deliver))
        }),

        // The `retired` check: true once reconcile has retired the run. spawn's exit handler
        // calls it after the run ends. spawn schedules the fiber and does not run it at once, so
        // `run` is assigned before the call.
        () => !run.wanted,
      ),
    }
    return run
  }

  // One reconcile step: make the runs match the subscriptions of one model.
  const reconcile = (wanted: ReadonlyArray<Subscription<Msg, R>>) =>
    Effect.gen(function* () {
      const keys = new Set(wanted.map((sub) => sub.key))

      // Pass 1: retire the run of each key that left, and forget retired runs that have ended.
      // Deleting the current entry while for...of walks a Map is safe in JavaScript.
      for (const [key, run] of runs) {
        if (run.wanted && !keys.has(key)) {
          // The flag goes first, so spawn's exit handler sees a retired run and logs nothing.
          run.wanted = false

          // interruptFork does not wait for the run to end. Fiber.interrupt would wait, and a
          // slow finalizer would hold up the whole loop. A returning key waits in its new run.
          yield* Fiber.interruptFork(run.fiber)
        } else if (!run.wanted && run.fiber.unsafePoll() !== null) {
          // unsafePoll returns the fiber's exit once it has ended. No returning key needs to
          // wait for this run any more.
          runs.delete(key)
        }
      }

      // Pass 2: start a run for each wanted key that has no wanted run. That is a new key, or
      // a key whose run is retired and becomes `previous`. A key with a wanted run keeps it,
      // even one that has ended. For equal keys, the first entry starts the run and the later
      // ones find it wanted.
      for (const sub of wanted) {
        const run = runs.get(sub.key)
        if (run?.wanted !== true) {
          runs.set(sub.key, start(sub, run))
        }
      }
    })

  // The loop itself. Stream.runForEach takes one model at a time, so reconcile steps never
  // overlap.
  //
  // Effect.suspend calls `subscriptions` inside the effect, so a throw becomes a defect that
  // catchAllCause sees. Without it, the throw would escape before catchAllCause is attached.
  //
  // catchAllCause logs the defect and ends the step with success. The loop keeps running, the
  // running streams stay as they were, and the next model gets a fresh call.
  return Stream.runForEach(stateStream(state), (model) =>
    Effect.suspend(() => reconcile(subscriptions(model))).pipe(
      Effect.catchAllCause((cause) => logDefect(program, 'subscription', cause)),
    ),
  )
}
