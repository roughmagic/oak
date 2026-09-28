import { Cause, HashMap, Layer, Logger, ManagedRuntime, Option } from 'effect'
import { onTestFinished } from 'vitest'
import type { Program } from '../src/index.js'

// A macrotask boundary drains every microtask chain the Effect scheduler queues.
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Returns what `f` throws, so a test can check the exact error instance. */
export const thrownBy = (f: () => void): unknown => {
  try {
    f()
  } catch (error) {
    return error
  }
  return undefined
}

interface Logged {
  readonly level: string
  readonly message: string
  readonly program: unknown
  readonly source: unknown
  readonly error: unknown
}

const annotation = (annotations: HashMap.HashMap<string, unknown>, key: string) =>
  Option.getOrUndefined(HashMap.get(annotations, key))

// The program captures its runtime when the layer builds, so the logger goes under the layer.
const logTo = (logs: Array<Logged>) =>
  Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ logLevel, message, annotations, cause }) => {
      logs.push({
        level: logLevel.label,
        message: Array.isArray(message) ? message.join(' ') : String(message),
        program: annotation(annotations, 'oak.program'),
        source: annotation(annotations, 'oak.source'),
        error: Cause.squash(cause),
      })
    }),
  )

export const start = <K extends string, M, Msg>(program: Program<K, M, Msg>) => {
  const logs: Array<Logged> = []
  const runtime = ManagedRuntime.make(program.layer.pipe(Layer.provide(logTo(logs))))
  onTestFinished(() => runtime.dispose())
  return { ...runtime.runSync(program), runtime, logs }
}
