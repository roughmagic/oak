// defect.ts: defects, the bugs Oak contains and reports.
//
// In Oak, an expected failure is a value. A command maps its errors to messages, and the model
// holds them. A defect is what is left: an exception from a listener, an exception from `update`
// on a message that a command or a stream sent, an Effect that dies, or, while the program runs,
// an interruption that Oak did not cause. The program's message type has no case for a defect,
// so Oak cannot turn one into a message. Oak logs it instead, and the program keeps running.
//
// Every defect goes through `logDefect`, at Error level, through Effect's Logger. The consumer
// decides where defects go by providing a Logger under the program layer.
//
// Place in Oak: program.ts and the reconcile loop (subscription.ts) call logDefect. The kernel
// reaches it through the `reportListener` callback that program.ts supplies.

import { type Cause, Effect } from 'effect'

/**
 * Where a defect came from. It becomes the `oak.source` log annotation.
 *
 * - `update`: `update` threw on a message from a command or a subscription. On a message that
 *   app code dispatches, `dispatch` throws to its caller instead, and Oak logs nothing.
 * - `listener`: a model listener threw.
 * - `command`: a command died, or ended by an interruption from its own work.
 * - `subscription`: a stream died, or ended by an interruption from its own work, or
 *   `subscriptions(model)` threw.
 *
 * A finalizer that dies while Oak stops a command or a stream is a defect of that source too.
 */
export type DefectSource = 'update' | 'listener' | 'command' | 'subscription'

/**
 * Logs a defect at Error level, annotated with the program key and the source.
 *
 * Its type has no error and requires no services, so any caller can run it: at the end of a
 * fiber, or in a fiber that `dispatch` forks when a listener throws. Every caller runs it on the
 * runtime the program captured when its layer built, so it reaches the Logger provided under the
 * program layer.
 */
export const logDefect = (
  program: string,
  source: DefectSource,
  cause: Cause.Cause<unknown>,
): Effect.Effect<void> =>
  // Two steps, in pipe order.
  //
  // 1. `Effect.logError` takes a `Cause` out of its message arguments and attaches it to the log
  //    entry. The Logger receives the `Cause` itself, not a string made from it.
  //
  // 2. `Effect.annotateLogs` adds key-value fields to the log entry. A Logger can filter or
  //    route defects by program and by source without parsing the message.
  Effect.logError(`Oak ${source} defect`, cause).pipe(
    Effect.annotateLogs({ 'oak.program': program, 'oak.source': source }),
  )
