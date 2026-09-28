import { Cause, Deferred, Effect, Exit, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeProgram, type Command, type NextModel } from '../src/index.js'
import { settle, start, thrownBy } from './helpers.js'

type Msg =
  | { readonly _tag: 'Inc' }
  | { readonly _tag: 'Throw' }
  // Run lets a test hand update any command.
  | { readonly _tag: 'Run'; readonly cmd: Command<Msg> }

const boom = new Error('boom from update')

const counter = (msg: Msg, model: number): NextModel<number, Msg> => {
  switch (msg._tag) {
    case 'Inc':
      return { model: model + 1, commands: [] }
    case 'Throw':
      throw boom
    case 'Run':
      return { model, commands: [msg.cmd] }
  }
}

const inc: Msg = { _tag: 'Inc' }
const run = (cmd: Command<Msg>): Msg => ({ _tag: 'Run', cmd })

const counterProgram = (key: string) =>
  makeProgram(key, { init: { model: 0, commands: [] }, update: counter })

interface Gate {
  readonly open: boolean
  readonly count: number
}

type GateMsg = { readonly _tag: 'Open' } | { readonly _tag: 'Close' } | { readonly _tag: 'Inc' }

// Runs `socket` while the gate is open. Inc changes the model and keeps the key.
const gateProgram = <R>(key: string, socket: Stream.Stream<never, never, R>) =>
  makeProgram(key, {
    init: { model: { open: true, count: 0 }, commands: [] },
    update: (msg: GateMsg, model: Gate) => ({
      model:
        msg._tag === 'Inc'
          ? { ...model, count: model.count + 1 }
          : { ...model, open: msg._tag === 'Open' },
      commands: [],
    }),
    subscriptions: (model) => (model.open ? [{ key: 'socket', stream: socket }] : []),
  })

describe('defects', () => {
  describe('update', () => {
    it('rethrows a throw from update to the app code that dispatched, and logs nothing', async () => {
      const { dispatch, logs } = start(counterProgram('test:update-throws'))
      expect(thrownBy(() => dispatch({ _tag: 'Throw' }))).toBe(boom)
      await settle()
      expect(logs).toEqual([])
    })

    it("logs a throw from update on a command's message as an update defect", async () => {
      const { state, dispatch, logs } = start(counterProgram('test:update-throws-command'))
      dispatch(run(Effect.succeed<Msg>({ _tag: 'Throw' })))
      await settle()
      expect(logs).toEqual([
        {
          level: 'ERROR',
          message: 'Oak update defect',
          program: 'test:update-throws-command',
          source: 'update',
          error: boom,
        },
      ])
      dispatch(inc)
      expect(state.value).toBe(1)
    })

    it("logs a throw from update on a stream's message and keeps the stream running", async () => {
      const program = makeProgram('test:update-throws-stream', {
        init: { model: 0, commands: [] },
        update: counter,
        subscriptions: () => [
          { key: 'messages', stream: Stream.fromIterable<Msg>([{ _tag: 'Throw' }, inc]) },
        ],
      })
      const { state, logs } = start(program)
      await settle()
      expect(logs).toMatchObject([{ message: 'Oak update defect', source: 'update' }])
      expect(state.value).toBe(1)
    })
  })

  describe('listeners', () => {
    it('logs a dispatch made inside a listener, and the other listeners still run', () => {
      const { state, dispatch, logs } = start(counterProgram('test:reenter-listener'))
      const seen: number[] = []
      state.subscribe(() => dispatch(inc))
      state.subscribe((model) => seen.push(model))
      dispatch(inc)
      expect(state.value).toBe(1)
      expect(seen).toEqual([1])
      expect(logs).toMatchObject([
        {
          level: 'ERROR',
          message: 'Oak listener defect',
          program: 'test:reenter-listener',
          source: 'listener',
        },
      ])
      expect(String(logs[0]?.error)).toContain('may not dispatch')
    })
  })

  describe('commands', () => {
    it('logs a command that dies, sends no message and keeps running', async () => {
      const { state, dispatch, logs } = start(counterProgram('test:command-dies'))
      dispatch(run(Effect.die(new Error('command crashed'))))
      await settle()
      expect(logs).toEqual([
        {
          level: 'ERROR',
          message: 'Oak command defect',
          program: 'test:command-dies',
          source: 'command',
          error: new Error('command crashed'),
        },
      ])
      dispatch(inc)
      expect(state.value).toBe(1)
    })

    it('logs a command that ends by an interruption from its own work', async () => {
      const deferred = Effect.runSync(Deferred.make<Msg>())
      const { state, dispatch, logs } = start(counterProgram('test:command-interrupted'))
      dispatch(run(Deferred.await(deferred)))
      await settle()
      await Effect.runPromise(Deferred.interrupt(deferred))
      await settle()
      expect(logs).toMatchObject([
        {
          level: 'ERROR',
          message: 'Oak command defect',
          program: 'test:command-interrupted',
          source: 'command',
          error: expect.any(Cause.InterruptedException),
        },
      ])
      dispatch(inc)
      expect(state.value).toBe(1)
    })

    // The README recipe: a command turns an interruption from its own work into a message.
    const orInc = (cmd: Command<Msg>): Command<Msg> =>
      cmd.pipe(
        Effect.catchAllCause((cause) =>
          Cause.isInterruptedOnly(cause) ? Effect.succeed(inc) : Effect.failCause(cause),
        ),
      )

    it('sends the message of a command that catches its own interruption', async () => {
      const deferred = Effect.runSync(Deferred.make<Msg>())
      const { state, dispatch, logs } = start(counterProgram('test:command-recipe'))
      dispatch(run(orInc(Deferred.await(deferred))))
      await settle()
      await Effect.runPromise(Deferred.interrupt(deferred))
      await settle()
      expect(state.value).toBe(1)
      expect(logs).toEqual([])
    })
  })

  describe('closing', () => {
    it('logs nothing when it interrupts running and not-yet-started commands', async () => {
      const { dispatch, runtime, logs } = start(counterProgram('test:close-commands'))
      dispatch(run(Effect.never))
      await settle()
      // Dispatched right before dispose, so it has not started yet.
      dispatch(run(Effect.never))
      await runtime.dispose()
      await settle()
      expect(logs).toEqual([])
    })

    it('drops the message of an uninterruptible command that finishes during close', async () => {
      const { state, dispatch, runtime, logs } = start(counterProgram('test:close-uninterruptible'))
      let slept = false
      const nap = Effect.sleep('5 millis').pipe(
        Effect.tap(() => {
          slept = true
        }),
      )
      dispatch(run(Effect.uninterruptible(nap).pipe(Effect.as(inc))))
      await settle()
      await runtime.dispose()
      await settle()
      expect(slept).toBe(true)
      expect(state.value).toBe(0)
      expect(logs).toEqual([])
    })

    it('logs a command finalizer that dies during close', async () => {
      const program = makeProgram('test:command-finalizer', {
        init: {
          model: 0,
          commands: [Effect.never.pipe(Effect.ensuring(Effect.die(new Error('close failed'))))],
        },
        update: counter,
      })
      const { runtime, logs } = start(program)
      await settle()
      await runtime.dispose()
      expect(logs).toEqual([
        {
          level: 'ERROR',
          message: 'Oak command defect',
          program: 'test:command-finalizer',
          source: 'command',
          error: new Error('close failed'),
        },
      ])
    })

    it('logs nothing when it interrupts streams, one of them waiting for its predecessor', async () => {
      const gate = Effect.runSync(Deferred.make<void>())
      const socket = Stream.never.pipe(Stream.ensuring(Deferred.await(gate)))
      const { dispatch, runtime, logs } = start(gateProgram('test:close-streams', socket))
      await settle()
      dispatch({ _tag: 'Close' })
      await settle()
      // The new run waits for the old one, which waits for the gate.
      dispatch({ _tag: 'Open' })
      await settle()
      const disposed = runtime.dispose()
      await settle()
      Deferred.unsafeDone(gate, Exit.void)
      await disposed
      await settle()
      expect(logs).toEqual([])
    })
  })

  describe('subscriptions', () => {
    it('logs a stream that ends by an interruption from its own work, and restarts it only when its key returns', async () => {
      const deferred = Effect.runSync(Deferred.make<never>())
      let starts = 0
      const counted = Stream.unwrap(
        Effect.sync(() => {
          starts++
          return Stream.fromEffect(Deferred.await(deferred))
        }),
      )
      const { dispatch, logs } = start(gateProgram('test:stream-interrupted', counted))
      await settle()
      await Effect.runPromise(Deferred.interrupt(deferred))
      await settle()
      expect(logs).toMatchObject([
        {
          level: 'ERROR',
          message: 'Oak subscription defect',
          program: 'test:stream-interrupted',
          source: 'subscription',
          error: expect.any(Cause.InterruptedException),
        },
      ])
      dispatch({ _tag: 'Inc' })
      await settle()
      expect(starts).toBe(1)
      dispatch({ _tag: 'Close' })
      await settle()
      dispatch({ _tag: 'Open' })
      await settle()
      expect(starts).toBe(2)
    })

    it('logs a stream that dies once, and does not restart it while its key stays', async () => {
      const program = gateProgram('test:stream-dies', Stream.die(new Error('stream crashed')))
      const { dispatch, logs } = start(program)
      await settle()
      dispatch({ _tag: 'Inc' })
      await settle()
      dispatch({ _tag: 'Inc' })
      await settle()
      expect(logs).toEqual([
        {
          level: 'ERROR',
          message: 'Oak subscription defect',
          program: 'test:stream-dies',
          source: 'subscription',
          error: new Error('stream crashed'),
        },
      ])
    })

    it('logs a throwing subscriptions function and leaves the running streams alone', async () => {
      const events: string[] = []
      const socket = (model: number) =>
        Stream.execute(Effect.sync(() => events.push(`open${model}`))).pipe(
          Stream.concat(Stream.never),
          Stream.ensuring(Effect.sync(() => events.push(`close${model}`))),
        )
      const program = makeProgram('test:subscriptions-throw', {
        init: { model: 0, commands: [] },
        update: counter,
        subscriptions: (model) => {
          if (model === 1) throw new Error('bad model')
          return [{ key: `socket:${model}`, stream: socket(model) }]
        },
      })
      const { dispatch, logs } = start(program)
      await settle()
      dispatch(inc)
      await settle()
      expect(logs).toEqual([
        {
          level: 'ERROR',
          message: 'Oak subscription defect',
          program: 'test:subscriptions-throw',
          source: 'subscription',
          error: new Error('bad model'),
        },
      ])
      expect(events).toEqual(['open0'])
      dispatch(inc)
      await settle()
      expect([...events].sort()).toEqual(['close0', 'open0', 'open2'])
      expect(logs).toHaveLength(1)
    })

    it('logs a stream finalizer that dies when its key leaves', async () => {
      const program = gateProgram(
        'test:stream-finalizer',
        Stream.never.pipe(Stream.ensuring(Effect.die(new Error('close failed')))),
      )
      const { dispatch, logs } = start(program)
      await settle()
      dispatch({ _tag: 'Close' })
      await settle()
      expect(logs).toEqual([
        {
          level: 'ERROR',
          message: 'Oak subscription defect',
          program: 'test:stream-finalizer',
          source: 'subscription',
          error: new Error('close failed'),
        },
      ])
    })
  })
})
