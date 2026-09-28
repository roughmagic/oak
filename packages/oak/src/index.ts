// index.ts: the public entry of `@roughmagic/oak`, The Elm Architecture on Effect.
//
// Oak's core is five small files. Read them in this order:
//
//   types.ts         the names: Command, NextModel, Update, OakState, ProgramService
//   kernel.ts        the kernel: dispatch runs update, stores the model, notifies listeners and
//                    hands each command on, all in one synchronous step
//   program.ts       makeProgram: the Effect shell that runs the kernel inside a Layer
//   subscription.ts  the reconcile loop: one stream per wanted key, started and stopped as the
//                    model changes
//   defect.ts        logDefect: the one path by which a defect reaches the consumer's Logger
//
// Only what an app needs to write and run a program leaves the package. makeProgram wires the
// kernel, the reconcile loop and logDefect together, so an app never calls them, and they stay
// internal.
//
// The `.js` extensions are required: with `moduleResolution: NodeNext`, a relative import names
// the file it loads at run time, and TypeScript maps it back to the `.ts` source.

// `makeProgram` is the one runtime value. `Program` and `ProgramId` are types that describe what
// it returns. Everything else a program needs comes from Effect.
export { makeProgram, type Program, type ProgramId } from './program.js'

// Types only. `export type` erases them from the compiled JavaScript, which `isolatedModules`
// requires for a re-exported type.
export type { Subscription, Subscriptions } from './subscription.js'
export type { Command, NextModel, OakState, ProgramService, Update } from './types.js'
