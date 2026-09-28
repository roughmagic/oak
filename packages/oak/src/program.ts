// program.ts: makeProgram, the Effect shell around the kernel.
//
// makeProgram returns a Program: one object that is the program's Context.Tag and also carries
// its `init` and its `layer`. makeProgram starts nothing. Building the layer runs the program:
// the layer makes a kernel, forks each command, the reconcile loop and each stream run as a
// fiber, feeds the messages they yield back into dispatch, logs every defect, and closes in a
// fixed order.
//
// Place in Oak: this file wires the others together. It supplies the kernel's `run` (kernel.ts),
// forks the reconcile loop (subscription.ts), and reports defects through logDefect (defect.ts).

import { Cause, Context, Effect, Exit, FiberSet, Layer, type Scope } from 'effect'
import { logDefect } from './defect.js'
import { makeKernel } from './kernel.js'
import { runSubscriptions, type Subscriptions } from './subscription.js'
import type { Command, NextModel, ProgramService } from './types.js'

// ---- Identity -----------------------------------------------------------------------------------
//
// A program has one identity at two levels. At runtime it is the key string: an Effect
// `Context` stores and finds each service by its tag's key. In types it is `ProgramId<K>`, the
// same key lifted into a type. The type checker then rejects a runtime that lacks the program.

// A phantom brand. `declare` emits no JavaScript, so the symbol, and the property typed with
// it, exist only for the type checker. No value ever carries them.
declare const ProgramIdTypeId: unique symbol

/**
 * The Effect service identifier of the program with key `K`. It exists only in types. A runtime
 * that provides the program has `ProgramId<K>` among its services, so a runtime that lacks it is
 * a compile error that names the key.
 */
// Invariant, so a key typed as plain string never stands in for a literal key. With a covariant
// K, `ProgramId<'@a/X'>` would be assignable to `ProgramId<string>`, and a runtime that provides
// a string-keyed program would type-check as one that provides '@a/X'. A consequence: a
// function that takes any program must be generic in K.
export interface ProgramId<in out K extends string> {
  readonly [ProgramIdTypeId]: K
}

// ---- Program ------------------------------------------------------------------------------------

/**
 * A program is the `Context.Tag` of its running service, so `runtime.runSync(program)` and
 * `yield* program` return the service. Its key alone identifies it.
 */
// One object plays three roles: the tag that finds the running service, the `init` that a view
// renders before anything runs, and the `layer` that runs it.
export interface Program<K extends string, M, Msg, R = never> extends Context.Tag<
  ProgramId<K>,
  ProgramService<M, Msg>
> {
  /** Elm's `init`: the first model and the commands to run at startup. */
  readonly init: NextModel<M, Msg, R>

  /**
   * Builds and runs the program. It requires the services `R` that commands and subscriptions
   * use, except `Scope`: each command and each stream run gets its own. Building it forks the
   * `init` commands and starts the subscriptions. Closing its scope stops dispatch, then
   * interrupts every command and subscription.
   */
  // The error type is never: nothing in the build fails.
  readonly layer: Layer.Layer<ProgramId<K>, never, Exclude<R, Scope.Scope>>
}

// ---- makeProgram --------------------------------------------------------------------------------

/**
 * Makes a program. `key` is its Effect service key, such as `'@my-app/Counter'`, and the
 * program's type carries it. Programs with different keys can run side by side in one runtime.
 *
 * `makeProgram` starts nothing. The program runs when its `layer` builds.
 */
export function makeProgram<K extends string, M, Msg, R = never>(
  key: K,
  // NoInfer: Msg comes from update's parameter, not from what commands and streams yield.
  // Without it, TypeScript would infer Msg from the messages of init's commands or of the
  // streams. That type is narrower, and `dispatch` would reject messages that `update` handles.
  config: {
    readonly init: NextModel<M, NoInfer<Msg>, R>
    readonly update: (msg: Msg, model: M) => NextModel<M, NoInfer<Msg>, R>
    readonly subscriptions?: Subscriptions<M, NoInfer<Msg>, R> | undefined
  },
): Program<K, M, Msg, R> {
  // Oak gives each command and each stream run its own Scope, through Effect.scoped. So the
  // runtime that builds the layer provides R without Scope. Env names that set of services.
  type Env = Exclude<R, Scope.Scope>

  const { init, update } = config

  // The program's identity at runtime. GenericTag makes a new object on each call, so the
  // Object.assign at the end changes this program's tag and no other.
  const tag = Context.GenericTag<ProgramId<K>, ProgramService<M, Msg>>(key)

  // The body of the layer. It runs once per build of the layer and returns the service that the
  // layer provides under `tag`. It runs inside the layer's Scope. Oak calls that Scope the
  // program's scope: closing it stops the program.
  const make = Effect.gen(function* () {
    // A FiberSet in the program's scope, and a fork function for it. FiberSet.makeRuntime
    // captures the runtime of the fiber that builds the layer: its services, its FiberRefs
    // (loggers, the scheduler, and Effect's default services such as Clock, Tracer and
    // ConfigProvider) and its runtime flags. So loggers, tracers and config provided under the
    // layer apply in every fiber that `fork` starts.
    //
    // Each fiber that `fork` starts joins the set and leaves it when it ends, so the set holds
    // only running fibers. When the program's scope closes, the set interrupts every fiber still
    // in it and waits for them to end. A fork after that starts nothing.
    const fork = yield* FiberSet.makeRuntime<Env>()

    // spawn starts the fibers that run the program's work: each command, the reconcile loop and
    // each stream run. Effect code inside them can fork fibers of its own, and
    // Fiber.interruptFork in the reconcile loop forks a short helper fiber. Those do not pass
    // through spawn.
    //
    // Each spawned fiber starts on Effect's scheduler, never inside the dispatch that caused it.
    // When the layer builds inside a synchronous run, the captured scheduler is a SyncScheduler
    // that Effect drains before that run returns: runSync's own, or the one a ManagedRuntime
    // makes for its build. So synchronous init commands have run by the time runSync returns.
    //
    // Effect.onExit runs the handler on every end: success, death and interruption alike.
    // Nothing can interrupt the handler, so it also sees Oak's own interruptions.
    //
    // Oak interrupts a fiber only after close, or after it retires a stream run. Those
    // interruptions are silent. Any other end without success is a defect: a death, or an
    // interruption from the work itself, such as awaiting an interrupted Deferred. A finalizer
    // that dies during a silent interruption adds a death to the cause, so Oak logs it too.
    const spawn = (
      source: 'command' | 'subscription',
      effect: Effect.Effect<void, never, Env>,
      // Only a stream run is ever retired. Commands and the reconcile loop keep the default.
      retired: () => boolean = () => false,
    ) =>
      fork(
        Effect.onExit(effect, (exit) =>
          Exit.isSuccess(exit) ||
          ((!kernel.open || retired()) && Cause.isInterruptedOnly(exit.cause))
            ? Effect.void
            : logDefect(key, source, exit.cause),
        ),
        // Queue the fiber on the scheduler instead of running it on the current stack.
        { immediate: false },
      )

    // A message from a command or a stream has no caller to throw to.
    //
    // deliver turns such a message into a dispatch. A throw from update becomes an `update`
    // defect in the log, and the fiber goes on: a stream keeps running after one bad message.
    // Effect.sync would turn the throw into a death of the fiber instead, which would stop a
    // stream and log the wrong source.
    //
    // Effect.suspend defers the dispatch until a fiber runs this effect. After close,
    // kernel.dispatch does nothing, so a late message is dropped.
    const deliver = (msg: Msg): Effect.Effect<void> =>
      Effect.suspend(() => {
        try {
          kernel.dispatch(msg)
          return Effect.void
        } catch (error) {
          return logDefect(key, 'update', Cause.die(error))
        }
      })

    // The kernel's `run`. It only queues a fiber and returns, so it never throws inside
    // dispatch, as the kernel requires.
    //
    // Effect.scoped gives the command its own Scope and closes it when the command ends, before
    // deliver runs. So a command's resources are released before its message is dispatched.
    const runCommand = (cmd: Command<Msg, R>): void => {
      spawn('command', Effect.flatMap(Effect.scoped(cmd), deliver))
    }

    // spawn and deliver read `kernel` before this line declares it. That is safe: they read it
    // only from inside fibers, and every fiber starts after makeKernel has returned.
    //
    // The last argument reports a listener that throws. The kernel is plain synchronous code and
    // cannot yield an Effect, so the report forks logDefect. Unlike spawn, it does not pass
    // `{ immediate: false }`: the fiber starts on the current stack, and logDefect never waits,
    // so the defect is logged before the next listener runs.
    const kernel = makeKernel<M, Msg, Command<Msg, R>>(init.model, update, runCommand, (error) => {
      fork(logDefect(key, 'listener', Cause.die(error)))
    })

    // Elm's startup commands. They start like any other command: queued now, run later.
    init.effects.forEach(runCommand)

    // The reconcile loop runs in one fiber for the life of the program. It watches the model and
    // keeps one stream run per wanted key. Each stream run is a fiber of its own, spawned with a
    // `retired` check, so Oak's interruption of a retired run stays silent.
    if (config.subscriptions !== undefined) {
      spawn(
        'subscription',
        runSubscriptions(key, kernel.state, config.subscriptions, deliver, (effect, retired) =>
          spawn('subscription', effect, retired),
        ),
      )
    }

    // Added last, so it runs first: dispatch stops before any fiber is interrupted.
    //
    // The program's scope runs its finalizers in reverse order, so this one runs before the
    // FiberSet's. Two things follow. A command that finishes during close delivers nothing. And
    // each handler in spawn sees the kernel closed, so the interruptions of close are silent,
    // not defects.
    yield* Effect.addFinalizer(() => Effect.sync(kernel.close))

    // The service is the kernel without `open` and `close`: only the program's scope closes it.
    return { state: kernel.state, dispatch: kernel.dispatch }
  })

  // The program is its own tag: Object.assign adds `init` and `layer` to the tag object. A Tag
  // is also an Effect that yields its service, so `yield* program` and
  // `runtime.runSync(program)` return the running service.
  //
  // The layer is made once, here. Effect memoizes layers by reference, so one build of a layer
  // graph runs one program, however many layers in it use `program.layer`.
  return Object.assign(tag, { init, layer: Layer.scoped(tag, make) })
}
