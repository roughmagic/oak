// types.ts: the vocabulary of Oak, the types that name the parts of The Elm Architecture (TEA).
//
// Elm names map to Oak names like this:
//   Cmd msg              ->  Command<Msg, R>
//   ( Model, Cmd Msg )   ->  NextModel<M, Msg, R>
//   update               ->  Update<M, Msg, R>
//   Sub msg              ->  Subscription<Msg, R>       (in subscription.ts)
//   subscriptions        ->  Subscriptions<M, Msg, R>   (in subscription.ts)
//
// Elm has one more part, `view`. Oak has none. A view binding, such as oak-react, reads `state`
// and calls `dispatch` on the `ProgramService`.
//
// This file holds types only, so it compiles to an empty module.
//
// Place in Oak: the kernel (kernel.ts) implements `ProgramService`, and program.ts runs each
// `Command` in a fiber of its own.

import type { Effect } from 'effect'

// ---- What update returns ------------------------------------------------------------------------

/**
 * Elm's `Cmd msg`: an Effect that always yields a message. Its error type is `never`: turn
 * failures into messages with `Effect.match` or `Effect.catchAll`, so the model can hold the
 * error.
 *
 * Oak runs each command in its own fiber and its own `Scope`, and dispatches the message it
 * yields. A command that dies is a defect. So is a command that ends by an interruption from its
 * own work while the program runs. Oak logs the defect and sends no message. Closing the
 * program's scope interrupts running commands silently.
 *
 * `R` is the set of services the command uses. The program's layer requires them, except
 * `Scope`: Oak gives each command a new `Scope` and closes it before it dispatches the message.
 */
// The error type `never` makes the compiler reject a command that can fail. Each command must
// map its failures to messages first, so every outcome reaches `update` as a message.
export type Command<Msg, R = never> = Effect.Effect<Msg, never, R>

/**
 * The next model and the commands to run. `commands: []` is Elm's `Cmd.none`.
 *
 * `commands` is required, so every branch of `update` states its commands, even when there are
 * none. An array of several commands is Elm's `Cmd.batch`.
 */
// An object, not Elm's tuple. TypeScript types an unannotated `[model, []]` as an array, such
// as `(number | never[])[]`, not as a pair. Named fields keep their types without annotations.
export interface NextModel<M, Msg, R = never> {
  readonly model: M
  readonly commands: ReadonlyArray<Command<Msg, R>>
}

/**
 * Elm's `update`. It is pure and never mutates the model: a change returns a new model, with
 * new objects along the path to every changed field. Oak compares models with `Object.is`, so
 * a message that returns the same model notifies nobody. If it throws, `dispatch` rethrows and
 * nothing changes.
 *
 * A message from a command or a subscription has no caller to throw to. If `update` throws on
 * one, Oak logs an `update` defect instead, and the model stays unchanged.
 */
// The arguments come in Elm's order, message first. A Redux reducer takes them the other way.
//
// New objects along the changed path let a view compare each part of the model by reference.
export type Update<M, Msg, R = never> = (msg: Msg, model: M) => NextModel<M, Msg, R>

// ---- What a running program offers --------------------------------------------------------------

/**
 * The current model and a listener for the next ones.
 *
 * Each read of `value` returns the latest model.
 */
// `subscribe` has the shape that React's `useSyncExternalStore` takes: a function that adds a
// listener and returns its remover.
export interface OakState<M> {
  readonly value: M
  /**
   * Calls `listener` with the new model after each change, inside the `dispatch` that made the
   * change. It does not call `listener` on subscribe, nor for a message that returns the same
   * model. Each call adds a new entry, so a function subscribed twice runs twice.
   *
   * A listener that throws is a `listener` defect: Oak logs it, and the other listeners still
   * run.
   *
   * Returns the function that removes the listener.
   */
  readonly subscribe: (listener: (model: M) => void) => () => void
}

/**
 * A running program: one way to read the model, one way to send a message.
 *
 * The program is the `Context.Tag` of this service, so `yield* program` and
 * `runtime.runSync(program)` return it.
 */
export interface ProgramService<M, Msg> {
  readonly state: OakState<M>
  /**
   * Runs `update`, stores the next model, notifies model listeners and schedules the
   * returned commands, all before it returns.
   *
   * If `update` throws, `dispatch` rethrows its error, and nothing changes.
   *
   * `update` and model listeners may not dispatch: a call made during another dispatch throws.
   * Messages from commands and subscriptions arrive later, each in its own dispatch, in no
   * guaranteed order. After the program's scope closes, `dispatch` does nothing.
   */
  // dispatch is synchronous so that a view sees the new model before the event that caused it
  // ends. A React controlled input needs this; kernel.ts explains why, where the listeners run.
  //
  // `this: void` states that dispatch does not use `this`, so callers can destructure it and
  // pass it as a callback.
  readonly dispatch: (this: void, msg: Msg) => void
}
