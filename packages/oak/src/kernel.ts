// kernel.ts: the kernel, the synchronous core of an Oak program.
//
// Elm's runtime runs one loop: take a message, call `update`, store the model, show it, and
// start the commands. The kernel is that loop and nothing more. It holds the model in one
// mutable cell, and `dispatch` is the only code that writes the cell.
//
// The kernel knows nothing about Effect. A command is an opaque value of type `C`, and the
// kernel hands it to `run`. So every asynchronous step lives outside this file.
//
// Place in Oak: the kernel implements the `ProgramService` of types.ts. program.ts makes one
// kernel each time the program's layer builds, supplies `run`, and closes the kernel when that
// build's scope closes.

import type { OakState, ProgramService } from './types.js'

/**
 * A program's synchronous core: the `ProgramService` plus a switch that turns it off.
 * program.ts serves only `state` and `dispatch` to the app. `open` and `close` stay inside Oak.
 */
export interface Kernel<M, Msg> extends ProgramService<M, Msg> {
  /**
   * False once `close` has run. program.ts reads it when a fiber ends without success. After
   * close, Oak treats an end by interruption alone as its own and logs nothing.
   */
  readonly open: boolean

  /**
   * Stops `dispatch` for good. When the program's scope closes, it calls `close` before it
   * interrupts any fiber.
   */
  close(): void
}

/**
 * Makes the synchronous core of a program.
 *
 * `dispatch` runs `update`, stores the next model, notifies listeners over a snapshot of the
 * listener set and hands each command to `run`. All of this finishes before `dispatch` returns.
 *
 * A throw from `update` reaches the caller and changes nothing. A throw from a listener goes to
 * `reportListener`, and the other listeners still run. `run` and `reportListener` must not throw.
 *
 * The kernel calls `run` while the dispatch is still running, so `run` must only schedule the
 * command. A command that ran in place and dispatched its message would hit the guard against
 * nested dispatch.
 */
export function makeKernel<M, Msg, C>(
  // The first model only. The kernel never sees init's commands: program.ts runs them itself.
  init: M,
  // Structural, not NextModel: NextModel ties commands to Effect, and the kernel stays generic.
  update: (msg: Msg, model: M) => { readonly model: M; readonly commands: ReadonlyArray<C> },
  run: (cmd: C) => void,
  reportListener: (error: unknown) => void,
): Kernel<M, Msg> {
  // The whole mutable state of a program: the model cell, the open switch, the guard against
  // nested dispatch and the listener set. They live in this closure, so only the functions
  // below can touch them.
  let model = init
  let open = true
  let dispatching = false
  const listeners = new Set<(model: M) => void>()

  // An arrow function has no `this`. That keeps the `this: void` promise of ProgramService.
  const dispatch = (msg: Msg): void => {
    // A closed kernel ignores every message, whoever sends it. So once the program's scope
    // starts to close, no message changes the model.
    if (!open) {
      return
    }

    // A message is one synchronous step. If update or a listener could dispatch, the
    // model would change under the dispatch that is still running.
    //
    // For example, a nested dispatch from update would store its model. The outer update would
    // then return a model built from the older one and overwrite it, and a message would be lost.
    //
    // From update, this throw leaves through the outer dispatch. From a listener, the
    // listener's try/catch below reports it as a listener defect.
    if (dispatching) {
      throw new Error(
        'Oak: dispatch was called during another dispatch. update and model listeners may not dispatch.',
      )
    }

    dispatching = true
    try {
      // Step 1: Elm's update. If it throws, the throw leaves here, before anything changes: the
      // model stays, no listener runs and no command starts.
      const { model: next, commands } = update(msg, model)

      // Step 2: store and notify, only when the model changed. A message that returns the same
      // model reaches no listener, so no view renders for it. React's own snapshot check, also
      // Object.is, agrees.
      if (!Object.is(next, model)) {
        // Stored before any listener runs, so a listener that reads state.value sees `next`.
        model = next

        // Listeners run here, before dispatch returns. This is what makes dispatch synchronous
        // for a view. React's useSyncExternalStore listener is one of them, so when an event
        // handler dispatches, React sees the change before the handler returns.
        //
        // A controlled input needs that. After an input event, React renders the updates the
        // event scheduled, then resets the input to its `value` prop. With a later notify, that
        // prop still holds the old text: React restores it, and the caret jumps to the end.
        //
        // Array.from takes a snapshot. A listener that subscribes or unsubscribes changes the
        // set from the next dispatch on. A live Set also visits entries added during the loop,
        // so a listener that resubscribes itself would loop forever.
        for (const listener of Array.from(listeners)) {
          // A throwing listener is a defect, not an error of this dispatch. The model is
          // already stored, so the other listeners still get it and the commands still run.
          try {
            listener(model)
          } catch (error) {
            reportListener(error)
          }
        }
      }

      // Step 3: hand over the commands, after every listener has seen the model. They run even
      // when the model did not change: a message may only start work, such as a fetch.
      //
      // `run` only schedules (see makeKernel above), so no command starts inside this dispatch.
      for (const cmd of commands) {
        run(cmd)
      }
    } finally {
      // Reset on every exit, a throw from update included, so the next dispatch works.
      dispatching = false
    }
  }

  // The read side of the service. `value` is a getter, so every read sees the current cell. A
  // plain property would copy the init model once and never change.
  const state: OakState<M> = {
    get value() {
      return model
    },

    // subscribe does not call the listener with the current model. A caller that needs it reads
    // state.value and subscribes in the same synchronous step, so no change falls between.
    subscribe: (listener) => {
      // One entry per call, so subscribing a function twice needs two unsubscribes, as in Redux.
      // The Set holds a new wrapper for each call, never the listener itself.
      const entry = (next: M) => listener(next)
      listeners.add(entry)

      // Removes only this call's entry. A second call finds nothing to delete.
      return () => {
        listeners.delete(entry)
      }
    },
  }

  // `state` and `dispatch` form the ProgramService. `open` is a getter for the same reason as
  // `value`: program.ts reads kernel.open long after this object is built, each time a fiber
  // ends without success.
  return {
    state,
    dispatch,
    get open() {
      return open
    },

    // Closing only stops dispatch. The model stays readable. Listeners stay registered, but no
    // dispatch reaches them again.
    close: () => {
      open = false
    },
  }
}
