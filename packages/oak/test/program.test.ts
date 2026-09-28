import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Queue,
  Schedule,
  Scope,
  Stream,
  TestClock,
  TestContext,
} from 'effect'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  makeProgram,
  type Command,
  type NextModel,
  type Program,
  type ProgramId,
  type ProgramService,
  type Subscriptions,
  type Update,
} from '../src/index.js'
import { settle, start } from './helpers.js'

type CounterMsg =
  | { readonly _tag: 'Inc' }
  // Run lets a test hand update any command.
  | { readonly _tag: 'Run'; readonly cmd: Command<CounterMsg> }

const counter = (msg: CounterMsg, model: number) => {
  switch (msg._tag) {
    case 'Inc':
      return { model: model + 1, effects: [] }
    case 'Run':
      return { model, effects: [msg.cmd] }
  }
}

const inc = { _tag: 'Inc' } as const

type GateMsg = { readonly _tag: 'Open' } | { readonly _tag: 'Close' }

// Runs `socket` while the model is true.
const socketProgram = <R>(key: string, socket: Stream.Stream<never, never, R>) =>
  makeProgram(key, {
    init: { model: true, effects: [] },
    update: (msg: GateMsg) => ({ model: msg._tag === 'Open', effects: [] }),
    subscriptions: (open) => (open ? [{ key: 'socket', stream: socket }] : []),
  })

describe('makeProgram', () => {
  describe('service', () => {
    it('is the Tag of its service: runSync(program) and yield* program return it', () => {
      const program = makeProgram('test:tag', { init: { model: 7, effects: [] }, update: counter })
      const runtime = ManagedRuntime.make(program.layer)
      onTestFinished(() => runtime.dispose())
      const service = runtime.runSync(program)
      expect(program.init).toEqual({ model: 7, effects: [] })
      expect(service.state.value).toBe(7)
      expect(
        runtime.runSync(
          Effect.gen(function* () {
            return yield* program
          }),
        ),
      ).toBe(service)
    })

    it('runs two programs with different keys side by side in one runtime', () => {
      const config = { init: { model: 0, effects: [] }, update: counter }
      const left = makeProgram('test:left', config)
      const right = makeProgram('test:right', config)
      const runtime = ManagedRuntime.make(Layer.merge(left.layer, right.layer))
      onTestFinished(() => runtime.dispose())
      runtime.runSync(left).dispatch(inc)
      runtime.runSync(left).dispatch(inc)
      runtime.runSync(right).dispatch(inc)
      expect(runtime.runSync(left).state.value).toBe(2)
      expect(runtime.runSync(right).state.value).toBe(1)
    })

    it('does nothing on dispatch after its scope closes', async () => {
      const program = makeProgram('test:closed', {
        init: { model: 0, effects: [] },
        update: counter,
      })
      const { state, dispatch, runtime } = start(program)
      await runtime.dispose()
      dispatch(inc)
      expect(state.value).toBe(0)
    })

    it('stops dispatch before it interrupts running commands', async () => {
      const program = makeProgram('test:close-order', {
        init: { model: 0, effects: [] },
        update: counter,
      })
      const { state, dispatch, runtime } = start(program)
      const onInterrupt = Effect.sync(() => dispatch(inc))
      dispatch({ _tag: 'Run', cmd: Effect.onInterrupt(Effect.never, () => onInterrupt) })
      await settle()
      await runtime.dispose()
      expect(state.value).toBe(0)
    })

    it('has run synchronous init commands and their follow-ups when the first runSync returns', () => {
      const program = makeProgram('test:first-run-sync', {
        init: {
          model: 0,
          effects: [Effect.succeed<CounterMsg>({ _tag: 'Run', cmd: Effect.succeed(inc) })],
        },
        update: counter,
      })
      const { state } = start(program)
      expect(state.value).toBe(1)
    })
  })

  describe('commands', () => {
    it('applies the message of a synchronous command after the dispatch that issued it', async () => {
      const program = makeProgram('test:sync-command', {
        init: { model: 0, effects: [] },
        update: counter,
      })
      const { state, dispatch, logs } = start(program)
      const seen: Array<number | string> = []
      state.subscribe((model) => seen.push(model))
      dispatch({ _tag: 'Run', cmd: Effect.succeed(inc) })
      seen.push('returned')
      expect(state.value).toBe(0)
      await settle()
      expect(seen).toEqual(['returned', 1])
      expect(logs).toEqual([])
    })

    it('runs init commands when the layer builds', async () => {
      let ran = 0
      const program = makeProgram('test:init-command', {
        init: {
          model: 0,
          effects: [
            Effect.sync(() => {
              ran++
              return inc
            }),
          ],
        },
        update: counter,
      })
      expect(ran).toBe(0)
      const { state } = start(program)
      await settle()
      expect(ran).toBe(1)
      expect(state.value).toBe(1)
    })

    it('runs a command with the services the layer requires', async () => {
      interface Numbers {
        readonly next: Effect.Effect<number>
      }
      const Numbers = Context.GenericTag<Numbers>('test:Numbers')
      type Msg = { readonly _tag: 'Fetch' } | { readonly _tag: 'Loaded'; readonly value: number }
      const fetch: Command<Msg, Numbers> = Effect.flatMap(Numbers, (numbers) =>
        Effect.map(numbers.next, (value) => ({ _tag: 'Loaded' as const, value })),
      )
      const program = makeProgram('test:command-service', {
        init: { model: 0, effects: [] },
        update: (msg: Msg, model: number) =>
          msg._tag === 'Fetch' ? { model, effects: [fetch] } : { model: msg.value, effects: [] },
      })
      const runtime = ManagedRuntime.make(
        program.layer.pipe(Layer.provide(Layer.succeed(Numbers, { next: Effect.succeed(42) }))),
      )
      onTestFinished(() => runtime.dispose())
      const { state, dispatch } = runtime.runSync(program)
      dispatch({ _tag: 'Fetch' })
      await settle()
      expect(state.value).toBe(42)
    })

    it('runs a delayed command and a ticker subscription on the TestClock', async () => {
      interface Timer {
        readonly ticks: number
        readonly running: boolean
      }
      type TimerMsg =
        | { readonly _tag: 'Start' }
        | { readonly _tag: 'Tick' }
        | { readonly _tag: 'Stop' }
      const program = makeProgram('test:timer', {
        init: { model: { ticks: 0, running: false }, effects: [] },
        update: (msg: TimerMsg, model: Timer) => {
          switch (msg._tag) {
            case 'Start':
              return {
                model: { ...model, running: true },
                effects: [Effect.as(Effect.sleep('4500 millis'), { _tag: 'Stop' as const })],
              }
            case 'Tick':
              return { model: { ...model, ticks: model.ticks + 1 }, effects: [] }
            case 'Stop':
              return { model: { ...model, running: false }, effects: [] }
          }
        },
        subscriptions: (model) =>
          model.running
            ? [
                {
                  key: 'ticker',
                  stream: Stream.fromSchedule(Schedule.spaced('1 second')).pipe(
                    Stream.as({ _tag: 'Tick' as const }),
                  ),
                },
              ]
            : [],
      })
      await Effect.gen(function* () {
        const { state, dispatch } = yield* program
        dispatch({ _tag: 'Start' })
        yield* TestClock.adjust('3 seconds')
        expect(state.value).toEqual({ ticks: 3, running: true })
        yield* TestClock.adjust('1 minute')
        expect(state.value).toEqual({ ticks: 4, running: false })
      }).pipe(
        Effect.provide(program.layer),
        Effect.provide(TestContext.TestContext),
        Effect.runPromise,
      )
    })

    type ScopedMsg = { readonly _tag: 'Run' } | { readonly _tag: 'Inc' }

    // Dispatches Run, which runs `cmd`, and records each message that update receives.
    const runScoped = (key: string, cmd: Command<ScopedMsg, Scope.Scope>, events: string[]) => {
      const program = makeProgram(key, {
        init: { model: 0, effects: [] },
        update: (msg: ScopedMsg, model: number) => {
          events.push(`update:${msg._tag}`)
          return msg._tag === 'Run' ? { model, effects: [cmd] } : { model: model + 1, effects: [] }
        },
      })
      // Oak gives each command its own Scope, so the layer does not require one.
      const layer: Layer.Layer<Context.Tag.Identifier<typeof program>, never, never> = program.layer
      const runtime = ManagedRuntime.make(layer)
      onTestFinished(() => runtime.dispose())
      runtime.runSync(program).dispatch({ _tag: 'Run' })
    }

    it("releases a command's resources before its message is dispatched", async () => {
      const events: string[] = []
      const cmd = Effect.acquireRelease(
        Effect.sync(() => events.push('acquire')),
        () => Effect.sync(() => events.push('release')),
      ).pipe(Effect.as({ _tag: 'Inc' as const }))
      runScoped('test:command-scope', cmd, events)
      await settle()
      expect(events).toEqual(['update:Run', 'acquire', 'release', 'update:Inc'])
    })

    it('interrupts the forkScoped children of a command when the command ends', async () => {
      const events: string[] = []
      const cmd = Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        yield* Effect.forkScoped(
          Deferred.succeed(started, undefined).pipe(
            Effect.zipRight(Effect.never),
            Effect.onInterrupt(() => Effect.sync(() => events.push('child interrupted'))),
          ),
        )
        yield* Deferred.await(started)
        return { _tag: 'Inc' as const }
      })
      runScoped('test:command-fork-scoped', cmd, events)
      await settle()
      expect(events).toEqual(['update:Run', 'child interrupted', 'update:Inc'])
    })
  })

  describe('subscriptions', () => {
    interface Model {
      readonly count: number
      readonly label: string
      readonly seen: readonly string[]
    }
    type Msg =
      | { readonly _tag: 'Inc' }
      | { readonly _tag: 'SetLabel'; readonly label: string }
      | { readonly _tag: 'Saw'; readonly label: string }
    const update = (msg: Msg, model: Model) => {
      switch (msg._tag) {
        case 'Inc':
          return { model: { ...model, count: model.count + 1 }, effects: [] }
        case 'SetLabel':
          return { model: { ...model, label: msg.label }, effects: [] }
        case 'Saw':
          return { model: { ...model, seen: [...model.seen, msg.label] }, effects: [] }
      }
    }
    const init: NextModel<Model, Msg> = { model: { count: 0, label: 'a', seen: [] }, effects: [] }
    const labelSubs: Subscriptions<Model, Msg> = (model) => [
      {
        key: `label:${model.label}`,
        stream: Stream.make({ _tag: 'Saw' as const, label: model.label }),
      },
    ]
    const setLabel = (label: string) => ({ _tag: 'SetLabel', label }) as const

    it('starts the subscriptions the init model implies', async () => {
      const program = makeProgram('test:sub-init', { init, update, subscriptions: labelSubs })
      const { state } = start(program)
      await settle()
      expect(state.value.seen).toEqual(['a'])
    })

    it('restarts a subscription when its key changes', async () => {
      const program = makeProgram('test:sub-restart', { init, update, subscriptions: labelSubs })
      const { state, dispatch, logs } = start(program)
      await settle()
      dispatch(setLabel('b'))
      await settle()
      dispatch(setLabel('c'))
      await settle()
      expect(state.value.seen).toEqual(['a', 'b', 'c'])
      expect(logs).toEqual([])
    })

    it('leaves a subscription alone while its key persists', async () => {
      const program = makeProgram('test:sub-persist', { init, update, subscriptions: labelSubs })
      const { state, dispatch } = start(program)
      await settle()
      dispatch({ _tag: 'Inc' })
      await settle()
      dispatch({ _tag: 'Inc' })
      await settle()
      expect(state.value.seen).toEqual(['a'])
    })

    it('restarts on a key change only, not on every change of the value behind it', async () => {
      const program = makeProgram('test:sub-key', {
        init,
        update,
        subscriptions: (model) => [
          {
            key: `label:${model.label.toLowerCase()}`,
            stream: Stream.make({ _tag: 'Saw' as const, label: model.label }),
          },
        ],
      })
      const { state, dispatch, logs } = start(program)
      await settle()
      dispatch(setLabel('A'))
      await settle()
      dispatch(setLabel('b'))
      await settle()
      expect(state.value.seen).toEqual(['a', 'b'])
      expect(logs).toEqual([])
    })

    it('does not restart a key that leaves and returns before Oak reconciles', async () => {
      const program = makeProgram('test:sub-burst', { init, update, subscriptions: labelSubs })
      const { state, dispatch } = start(program)
      await settle()
      dispatch(setLabel('b'))
      dispatch(setLabel('a'))
      await settle()
      expect(state.value.seen).toEqual(['a'])
    })

    it('runs equal keys as one subscription and logs nothing', async () => {
      const program = makeProgram('test:sub-equal', {
        init,
        update,
        subscriptions: (model) => [...labelSubs(model), ...labelSubs(model)],
      })
      const { state, dispatch, logs } = start(program)
      await settle()
      dispatch(setLabel('b'))
      await settle()
      expect(state.value.seen).toEqual(['a', 'b'])
      expect(logs).toEqual([])
    })

    it('starts a returning key only after the previous run has finished', async () => {
      const gate = Effect.runSync(Deferred.make<void>())
      const events: string[] = []
      const socket = Stream.execute(Effect.sync(() => events.push('open'))).pipe(
        Stream.concat(Stream.never),
        Stream.ensuring(Effect.andThen(Deferred.await(gate), () => events.push('close'))),
      )
      const { dispatch, logs } = start(socketProgram('test:sub-handover', socket))
      // Registered after start, so it runs before dispose, which waits for the gate.
      onTestFinished(() => Deferred.unsafeDone(gate, Exit.void))
      await settle()
      expect(events).toEqual(['open'])
      dispatch({ _tag: 'Close' })
      await settle()
      dispatch({ _tag: 'Open' })
      await settle()
      expect(events).toEqual(['open'])
      Deferred.unsafeDone(gate, Exit.void)
      await settle()
      expect(events).toEqual(['open', 'close', 'open'])
      expect(logs).toEqual([])
    })

    it('keeps the handover order when a key flaps while the first run is still closing', async () => {
      const gate = Effect.runSync(Deferred.make<void>())
      const events: string[] = []
      let opened = 0
      // Only the first stream waits for the gate before it closes.
      const socket = Stream.unwrap(
        Effect.sync(() => {
          const id = ++opened
          return Stream.execute(Effect.sync(() => events.push(`open${id}`))).pipe(
            Stream.concat(Stream.never),
            Stream.ensuring(
              Effect.andThen(id === 1 ? Deferred.await(gate) : Effect.void, () =>
                events.push(`close${id}`),
              ),
            ),
          )
        }),
      )
      const { dispatch, logs } = start(socketProgram('test:sub-flap', socket))
      onTestFinished(() => Deferred.unsafeDone(gate, Exit.void))
      await settle()
      for (const _tag of ['Close', 'Open', 'Close', 'Open'] as const) {
        dispatch({ _tag })
        await settle()
      }
      expect(events).toEqual(['open1'])
      Deferred.unsafeDone(gate, Exit.void)
      await settle()
      // The run in between was interrupted while it waited, so it never opened.
      expect(events).toEqual(['open1', 'close1', 'open2'])
      expect(logs).toEqual([])
    })

    it('runs one fiber per key and interrupts only the key that leaves', async () => {
      interface Watch {
        readonly pending: readonly string[]
        readonly started: readonly string[]
      }
      type WatchMsg =
        | { readonly _tag: 'Add'; readonly id: string }
        | { readonly _tag: 'Remove'; readonly id: string }
        | { readonly _tag: 'Started'; readonly id: string }
      const released: string[] = []
      const program = makeProgram('test:sub-keyed', {
        init: { model: { pending: ['x', 'y'], started: [] }, effects: [] },
        update: (msg: WatchMsg, model: Watch) => {
          switch (msg._tag) {
            case 'Add':
              return { model: { ...model, pending: [...model.pending, msg.id] }, effects: [] }
            case 'Remove':
              return {
                model: { ...model, pending: model.pending.filter((id) => id !== msg.id) },
                effects: [],
              }
            case 'Started':
              return { model: { ...model, started: [...model.started, msg.id] }, effects: [] }
          }
        },
        subscriptions: (model) =>
          model.pending.map((id) => ({
            key: `watch:${id}`,
            stream: Stream.make({ _tag: 'Started' as const, id }).pipe(
              Stream.concat(Stream.never),
              Stream.ensuring(Effect.sync(() => released.push(id))),
            ),
          })),
      })
      const { state, dispatch, runtime, logs } = start(program)
      await settle()
      expect(state.value.started).toEqual(['x', 'y'])
      dispatch({ _tag: 'Remove', id: 'x' })
      await settle()
      expect(released).toEqual(['x'])
      dispatch({ _tag: 'Add', id: 'z' })
      await settle()
      expect(state.value.started).toEqual(['x', 'y', 'z'])
      expect(released).toEqual(['x'])
      await runtime.dispose()
      expect([...released].sort()).toEqual(['x', 'y', 'z'])
      expect(logs).toEqual([])
    })

    it('restarts a stream on demand through a counter in its key', async () => {
      interface Socket {
        readonly generation: number
      }
      const events: string[] = []
      const socket = (generation: number) =>
        Stream.execute(Effect.sync(() => events.push(`open${generation}`))).pipe(
          Stream.concat(Stream.never),
          Stream.ensuring(Effect.sync(() => events.push(`close${generation}`))),
        )
      const program = makeProgram('test:sub-generation', {
        init: { model: { generation: 0 }, effects: [] },
        update: (_msg: { readonly _tag: 'Restart' }, model: Socket) => ({
          model: { generation: model.generation + 1 },
          effects: [],
        }),
        subscriptions: (model) => [
          { key: `socket:${model.generation}`, stream: socket(model.generation) },
        ],
      })
      const { dispatch, logs } = start(program)
      await settle()
      expect(events).toEqual(['open0'])
      dispatch({ _tag: 'Restart' })
      await settle()
      // Different keys are different subscriptions, so the new run does not wait for the old one.
      expect([...events].sort()).toEqual(['close0', 'open0', 'open1'])
      expect(logs).toEqual([])
    })

    it('runs each stream in its own Scope, closed when its key is retired', async () => {
      const events: string[] = []
      const socket = Stream.fromEffect(
        Effect.acquireRelease(
          Effect.sync(() => events.push('acquire')),
          () => Effect.sync(() => events.push('release')),
        ),
      ).pipe(Stream.drain, Stream.concat(Stream.never))
      const program = socketProgram('test:sub-scope', socket)
      // Oak gives each stream run its own Scope, so the layer does not require one.
      const layer: Layer.Layer<Context.Tag.Identifier<typeof program>, never, never> = program.layer
      const runtime = ManagedRuntime.make(layer)
      onTestFinished(() => runtime.dispose())
      const { dispatch } = runtime.runSync(program)
      await settle()
      expect(events).toEqual(['acquire'])
      dispatch({ _tag: 'Close' })
      await settle()
      expect(events).toEqual(['acquire', 'release'])
    })

    it('keeps the key of a stream that completes, such as fromQueue after a shutdown', async () => {
      const queue = Effect.runSync(Queue.unbounded<Msg>())
      let starts = 0
      const program = makeProgram('test:sub-from-queue', {
        init,
        update,
        subscriptions: () => [
          {
            key: 'inbox',
            stream: Stream.unwrap(
              Effect.sync(() => {
                starts++
                return Stream.fromQueue(queue)
              }),
            ),
          },
        ],
      })
      const { state, dispatch, logs } = start(program)
      await settle()
      Effect.runSync(Queue.offer(queue, { _tag: 'Saw', label: 'queued' }))
      await settle()
      expect(state.value.seen).toEqual(['queued'])
      Effect.runSync(Queue.shutdown(queue))
      await settle()
      dispatch({ _tag: 'Inc' })
      await settle()
      expect(starts).toBe(1)
      expect(logs).toEqual([])
    })
  })

  describe('types', () => {
    it("takes Msg from update's parameter, not from the messages commands and streams yield", () => {
      type Msg =
        | { readonly _tag: 'Load' }
        | { readonly _tag: 'Loaded' }
        | { readonly _tag: 'Tick' }
        | { readonly _tag: 'Reset' }
      const loaded = Effect.succeed({ _tag: 'Loaded' as const })
      const update = (msg: Msg, model: number) =>
        msg._tag === 'Load' ? { model, effects: [loaded] } : { model: 0, effects: [] }
      const ticks = Stream.make({ _tag: 'Tick' as const })
      // Each dispatch(Reset) below compiles only because of the NoInfer in makeProgram.
      const plain = makeProgram('test:infer-update', { init: { model: 0, effects: [] }, update })
      const withInit = makeProgram('test:infer-init', {
        init: { model: 0, effects: [loaded] },
        update,
      })
      const withSubs = makeProgram('test:infer-subs', {
        init: { model: 0, effects: [] },
        update,
        subscriptions: () => [{ key: 'tick', stream: ticks }],
      })
      start(plain).dispatch({ _tag: 'Reset' })
      start(withInit).dispatch({ _tag: 'Reset' })
      start(withSubs).dispatch({ _tag: 'Reset' })
    })

    const config = { init: { model: 0, effects: [] }, update: counter }

    it('types a program by its key, so a runtime that lacks it is a compile error', () => {
      const program = makeProgram('test:x', config)
      const other = makeProgram('test:y', config)
      const otherRuntime = ManagedRuntime.make(other.layer)
      onTestFinished(() => otherRuntime.dispose())
      // @ts-expect-error: the runtime provides test:y, not test:x.
      expect(() => otherRuntime.runSync(program)).toThrow()
      type Id = Context.Tag.Identifier<typeof program>
      const toId = (id: Id): ProgramId<'test:x'> => id
      const fromId = (id: ProgramId<'test:x'>): Id => id
      void toId
      void fromId
    })

    it('takes one set of services for the whole program from the annotated update', () => {
      interface A {
        readonly a: Effect.Effect<CounterMsg>
      }
      interface B {
        readonly b: Stream.Stream<CounterMsg>
      }
      const A = Context.GenericTag<A>('test:A')
      const B = Context.GenericTag<B>('test:B')
      const update: Update<number, CounterMsg, A | B> = (_msg, model) => ({
        model,
        effects: [Effect.flatMap(A, (a) => a.a)],
      })
      const subscriptions = () => [{ key: 'b', stream: Stream.unwrap(Effect.map(B, (b) => b.b)) }]
      const program = makeProgram('test:services', {
        init: { model: 0, effects: [] },
        update,
        subscriptions,
      })
      type Id = Context.Tag.Identifier<typeof program>
      const both: Layer.Layer<Id, never, A | B> = program.layer
      // @ts-expect-error: the layer requires B too.
      const onlyA: Layer.Layer<Id, never, A> = program.layer
      void both
      void onlyA
    })

    it('accepts subscriptions that may be undefined', () => {
      const maybe = (on: boolean): Subscriptions<number, CounterMsg> | undefined =>
        on ? () => [] : undefined
      const program = makeProgram('test:maybe-subs', { ...config, subscriptions: maybe(false) })
      expect(start(program).state.value).toBe(0)
    })

    it('lets callers destructure dispatch and pass it as a callback', () => {
      const service = start(makeProgram('test:unbound', config))
      const { dispatch } = service
      const messages: CounterMsg[] = [inc, inc]
      messages.forEach(dispatch)
      expect(service.state.value).toBe(2)
    })

    it('does not widen a service to messages its program does not accept', () => {
      const service: ProgramService<number, CounterMsg> = start(makeProgram('test:narrow', config))
      // @ts-expect-error: dispatch would take a message that update does not handle.
      const wider: ProgramService<number, CounterMsg | { readonly _tag: 'Other' }> = service
      void wider
    })

    it('takes any key in a helper that is generic in the key', () => {
      const program = makeProgram('test:helper', config)
      const anyKey = <K extends string>(p: Program<K, number, CounterMsg>) => p.key
      const stringKey = (p: Program<string, number, CounterMsg>) => p.key
      expect(anyKey(program)).toBe('test:helper')
      // @ts-expect-error: Program<string, …> takes only programs whose key is typed string.
      expect(stringKey(program)).toBe('test:helper')
    })
  })
})
