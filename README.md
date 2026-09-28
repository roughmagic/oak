# Oak

> The Elm Architecture for TypeScript, built on Effect.

## Introduction

Oak is a TypeScript implementation of [The Elm Architecture](https://guide.elm-lang.org/architecture/) (TEA). If you know Elm, you already know Oak: one model, messages, a pure `update` function, commands and subscriptions. Oak uses [Effect](https://effect.website) for the parts that Elm's runtime handles. A command is an `Effect`. A subscription is a `Stream`. Services come from Effect `Layer`s, and a running program is an Effect service.

| Elm                                         | Oak                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Model`                                     | Any immutable TypeScript value                                                           |
| `Msg`                                       | A tagged union, such as `Data.TaggedEnum`                                                |
| `init : flags -> (Model, Cmd Msg)`          | `init: { model, commands }`                                                              |
| `update : Msg -> Model -> (Model, Cmd Msg)` | `update(msg, model) => { model, commands }`                                              |
| `Cmd Msg`                                   | `Command<Msg, R>`, which is `Effect<Msg, never, R>`                                      |
| `Cmd.none`                                  | `commands: []`                                                                           |
| `subscriptions : Model -> Sub Msg`          | `subscriptions(model) => [{ key, stream }]`, where `stream` is a `Stream<Msg, never, R>` |
| `Browser.element`                           | `makeProgram(key, { init, update, subscriptions })` and `OakProvider`                    |

`init` and every `update` result have one shape, `NextModel`: the model and the commands to run. Elm passes flags to `init`. In Oak, a function that takes the flags makes the program. [Server rendering and Next.js](#server-rendering-and-nextjs) shows this with server data.

Dispatch is synchronous. `dispatch(msg)` runs `update` and stores the new model before it returns. React components read the model through `useSyncExternalStore`. The first render shows a real model, never a loading state: `init.model` until the program runs, and the live model after. The server always renders `init.model`.

A program runs as an Effect `Layer`. You build the Effect runtime yourself, with your services, loggers, tracers and config, and add the program's layer to it. Oak does not configure the runtime.

## Installation

For a React app:

```sh
npm install @roughmagic/oak @roughmagic/oak-react effect react
```

Without React:

```sh
npm install @roughmagic/oak effect
```

## Quick start

```tsx
import { makeProgram, type Update } from '@roughmagic/oak'
import { createOakHooks, OakProvider } from '@roughmagic/oak-react'
import { Data, ManagedRuntime } from 'effect'

interface Model {
  readonly count: number
}

type Msg = Data.TaggedEnum<{
  Increment: {}
  Reset: {}
}>
const Msg = Data.taggedEnum<Msg>()

const update: Update<Model, Msg> = (msg, model) =>
  Msg.$match(msg, {
    Increment: () => ({ model: { count: model.count + 1 }, commands: [] }),
    Reset: () => ({ model: { count: 0 }, commands: [] }),
  })

const Counter = makeProgram('@my-app/Counter', {
  init: { model: { count: 0 }, commands: [] },
  update,
})

const runtime = ManagedRuntime.make(Counter.layer)
const { useSelector, useDispatch } = createOakHooks<Model, Msg>()

function CountButton() {
  const count = useSelector((m) => m.count)
  const dispatch = useDispatch()
  return <button onClick={() => dispatch(Msg.Increment())}>{count}</button>
}

export function App() {
  return (
    <OakProvider runtime={runtime} program={Counter}>
      <CountButton />
    </OakProvider>
  )
}
```

- `makeProgram` takes a key and `{ init, update }`. The key is the program's Effect service key, and the program's type carries it.
- `Counter.layer` runs the program. `ManagedRuntime.make` builds nothing until first use.
- `OakProvider` serves the program to the hooks below it. A React app has one, near the root. It takes `runtime`, a runtime that the app owns, or `layer`, a runtime that the provider owns for one mount. See [React](#react).
- `createOakHooks<Model, Msg>()` returns `useSelector` and `useDispatch`, typed for the program. In an app, call it once in a `hooks.ts` module and import the hooks from there.

## Guide

### Update

`update(msg, model)` returns a `NextModel`: `{ model, commands }`. `model` is the next model. `commands` lists the commands to run. `commands` is required, and `commands: []` is Elm's `Cmd.none`.

`update` is pure and never mutates the model. A change returns a new model, with new objects along the path to every changed field. A message that changes nothing may return the same model. Oak compares models with `Object.is`, so the same model notifies nobody.

`update` reads nothing but its arguments. When a message needs the current time, the event handler puts the time in the message:

```ts
dispatch(Msg.SetStatus({ id, status, at: new Date().toISOString() }))
```

A command can also read Effect's `Clock` or `Random` and return a message that carries the value.

A pure `update` needs no runtime to test:

```ts
expect(update(Msg.Increment(), { count: 1 })).toEqual({ model: { count: 2 }, commands: [] })
```

The model can be plain readonly objects or `Data.case` values. example-programs and example-react use `Data.case` models and change them through `@fp-ts/optic` lenses. [example-programs](examples/example-programs#models) shows how a lens keeps a `Data.case` model's structural equality. example-next and example-remote-data use plain readonly objects and spreads. example-next needs a plain model, because its seed crosses from the server to the client.

### Commands

A command is an `Effect` that yields one message. Its type is `Command<Msg, R>`, which is `Effect<Msg, never, R>`. `update` returns commands in its `commands` field. Oak runs each one on the program's runtime and dispatches the message it yields. The commands in `init.commands` run when the program starts.

A delayed increment, as one case of `update`:

```ts
IncrementLater: () => ({
  model,
  commands: [Effect.as(Effect.sleep('1 second'), Msg.Increment())],
}),
```

A command is total: its error type is `never`. Turn each failure into a message with `Effect.match` or `Effect.catchAll`, so the model can hold the error:

```ts
import type { Command, Update } from '@roughmagic/oak'
import { Data, Effect } from 'effect'

interface Model {
  readonly pending: boolean
  readonly joke: string | null
  readonly error: string | null
}

type Msg = Data.TaggedEnum<{
  Fetch: {}
  Got: { readonly joke: string }
  Failed: { readonly error: string }
}>
const Msg = Data.taggedEnum<Msg>()

const fetchJoke: Command<Msg, JokeService> = Effect.flatMap(
  JokeService,
  (service) => service.fetchJoke,
).pipe(
  Effect.match({
    onSuccess: (joke) => Msg.Got({ joke }),
    onFailure: (error) => Msg.Failed({ error: error.message }),
  }),
)

const update: Update<Model, Msg, JokeService> = (msg, model) =>
  Msg.$match(msg, {
    Fetch: () => ({ model: { ...model, pending: true, error: null }, commands: [fetchJoke] }),
    Got: ({ joke }) => ({ model: { pending: false, joke, error: null }, commands: [] }),
    Failed: ({ error }) => ({ model: { ...model, pending: false, error }, commands: [] }),
  })
```

`JokeService` is an Effect service. [Services](#services) defines it.

A command always returns a message, like Elm's `Cmd msg`. While the program runs, a command that ends without a message is a defect. It either died, from a thrown exception or `Effect.die`, or it ended by an interruption from its own work, such as a `Queue.take` on a queue that shuts down. Oak logs the defect and sends no message, and the program keeps running. A command can catch an interruption from its own work with `Effect.catchAllCause` and turn it into a message. The [`@roughmagic/oak` README](packages/oak/README.md#commands) shows the recipe. See also [Defects and logging](#defects-and-logging).

Commands run concurrently, each in its own fiber. Closing the program's scope interrupts every command that is still running. Only Oak holds a command's fiber, so this is the only way a command is interrupted from outside. Oak treats it as normal and logs nothing.

Each command runs in its own `Scope`. Oak closes it when the command ends, before it dispatches the message. A resource from `Effect.acquireRelease` is released then, and a fiber from `Effect.forkScoped` is interrupted. A resource that should live as long as the program belongs in a service layer or a subscription.

### Services

`R` in `Command<Msg, R>`, `Update<M, Msg, R>` and `Subscriptions<M, Msg, R>` is the set of services that commands and streams use. The program's `layer` requires `R`, except `Scope`: each command and each stream run gets its own. Provide the services under the program layer with `Layer.provide`:

```ts
import { makeProgram } from '@roughmagic/oak'
import { Context, Data, Effect, Layer, ManagedRuntime } from 'effect'

class JokeError extends Data.TaggedError('JokeError')<{ readonly message: string }> {}

interface JokeService {
  readonly fetchJoke: Effect.Effect<string, JokeError>
}
const JokeService = Context.GenericTag<JokeService>('@my-app/JokeService')

const JokeServiceLive = Layer.succeed(
  JokeService,
  JokeService.of({
    fetchJoke: Effect.tryPromise({
      try: async () => {
        const res = await fetch('https://icanhazdadjoke.com/', {
          headers: { Accept: 'text/plain' },
        })
        // fetch resolves on an HTTP error status, so check it here.
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        return res.text()
      },
      catch: (cause) =>
        new JokeError({ message: cause instanceof Error ? cause.message : String(cause) }),
    }),
  }),
)

const Jokes = makeProgram('@my-app/Jokes', {
  init: { model: { pending: false, joke: null, error: null }, commands: [] },
  update,
})

const runtime = ManagedRuntime.make(Jokes.layer.pipe(Layer.provide(JokeServiceLive)))
```

`Jokes` is a `Program<'@my-app/Jokes', Model, Msg, JokeService>`. TypeScript infers `R` from `update` here, so a missing service is a type error at `ManagedRuntime.make`.

A program has one set of services, `R`, for its commands and its subscriptions together. TypeScript infers it when the program uses one service. A program that uses more than one service annotates `update` with the union of all of them, such as `Update<Model, Msg, JokeService | Ledger>`; `init` and `subscriptions` then check against that union. Oak takes `Msg` from the parameter of `update`, never from the messages that commands or streams yield.

In tests, provide a fake layer instead of `JokeServiceLive`. See [Testing](#testing).

### Dispatch rules

`dispatch(msg)` is one synchronous step:

1. Oak calls `update(msg, model)`.
2. Oak stores the returned model and calls each model listener with it.
3. Oak schedules the returned commands on the program's runtime.

Outside React, read the program's service from the runtime:

```ts
const { state, dispatch } = runtime.runSync(Counter)

state.subscribe((model) => console.log(model.count))
dispatch(Msg.Increment()) // logs 1 before dispatch returns
```

`dispatch` is declared with `this: void`, so you can destructure it and pass it as a callback.

The rules:

- When `dispatch` returns, `state.value` holds the new model. Dispatches from one event handler run in call order.
- If `update` throws, `dispatch` rethrows the error to its caller and nothing changes: the model stays, no listener runs, no command starts, and Oak logs nothing. The next `dispatch` works. Redux treats a reducer that throws the same way.
- A dispatch during a dispatch throws an `Error`. `update` and model listeners may not dispatch, because the model would change under the dispatch that is still running. A dispatch from `update` throws inside `update`, so the error comes out of the outer `dispatch`.
- A model listener that throws, for this or any other reason, is a `listener` defect. Oak logs it, and the other listeners still run.
- Nobody listens for messages, only for the model. Oak has no message log and no middleware. `state.value`, `state.subscribe`, `useSelector` and subscriptions all read the model. To react to a message, change the model in `update` or return a command.
- Messages from commands and subscriptions arrive later, each in its own dispatch, in no guaranteed order. Every command and stream starts on Effect's scheduler, never inside the dispatch that caused it. Even `Effect.succeed(msg)` lands after the dispatch that returned it.
- A message from a command or a stream has no caller to throw to. If `update` throws on it, Oak logs an `update` defect and keeps running.
- After the program's scope closes, `dispatch` does nothing.

With a `ManagedRuntime`, the first `runtime.runSync(program)` builds the layer. When it returns, synchronous `init` commands and their synchronous follow-ups have already run and been dispatched, because Effect flushes its synchronous scheduler before `runSync` returns. They still never run inside a `dispatch`.

### Subscriptions

A subscription is a `Stream` of messages under a key. `subscriptions(model)` returns the subscriptions that the model asks for:

```ts
import { makeProgram, type Subscriptions } from '@roughmagic/oak'
import { Effect, Stream } from 'effect'

const subscriptions: Subscriptions<Model, Msg> = (model) =>
  model.running
    ? [
        {
          key: `tick:${model.intervalMs}`,
          stream: Stream.repeatEffect(Effect.as(Effect.sleep(model.intervalMs), Msg.Tick())),
        },
      ]
    : []

const Timer = makeProgram('@my-app/Timer', { init, update, subscriptions })
```

Oak calls `subscriptions` with the latest model when the program starts and after the model changes. It compares the keys with the running subscriptions. A new key starts its stream. A key that is gone has its stream interrupted. A key that is still there keeps its stream running, and Oak ignores the new stream.

The key rule:

> The key names every model value the stream reads, and nothing else. Oak runs only the stream from the call where its key first appeared. A value missing from the key goes stale; a value in the key restarts the stream when it changes.

```ts
// Wrong: the account changes, the key does not, and the old poll keeps running.
{ key: 'balance', stream: pollBalance(model.account) }
// Right
{ key: `balance:${model.account}`, stream: pollBalance(model.account) }
```

Above, the ticker reads only `intervalMs`, so the key names only `intervalMs`. A new interval restarts the ticker. Setting `running` to `false` removes the key and stops the ticker. If a stream needs data that changes often and should not restart it, emit a plain message and read the current model in `update`.

Lifecycle:

- Equal keys are one subscription. Oak runs it once.
- Each run has its own `Scope`, closed when the run ends.
- A stream that completes keeps its key. It runs again only after the key leaves and comes back.
- Oak interrupts a stream silently when its key leaves and when the program's scope closes.
- A stream that dies, or that ends by an interruption from its own work while its key is wanted, is a defect. Oak logs it, and the stream stays stopped until its key leaves and comes back.
- A key that comes back starts its new stream after the previous run has finished, finalizers included.
- Oak reconciles against the latest model only. A key that leaves and returns before Oak reconciles does not restart its stream. This happens when the key leaves and returns within one synchronous burst of dispatches, or through a synchronous command.
- If `subscriptions` throws, Oak logs the defect and leaves the running streams alone.

`Stream.fromQueue(queue)` completes when the queue shuts down, so it keeps its key and Oak logs nothing. `Stream.repeatEffect(Queue.take(queue))` is interrupted when the queue shuts down, so Oak logs it as a defect.

To restart a stream on demand, put a counter in its key and increment the counter in `update`:

```ts
{ key: `socket:${model.generation}`, stream: openSocket(model.url) }
```

Oak interrupts a stream asynchronously, so a message can arrive after its key has left. `update` must accept messages for things that are gone. In the transfer program in [example-programs](examples/example-programs), a `Settled` message for a transfer that is no longer pending changes nothing.

Choose between a command and a subscription by lifetime. A command runs once, because `update` decided so, and it runs to the end unless the program stops. A subscription runs while the model holds its key, and Oak interrupts it when the key leaves. A timer that nothing needs to stop, such as a toast's expiry, is a delayed command.

### Stale responses

Two requests for the same data can answer out of order. The older response then overwrites the newer one. Guard against this with a request id:

1. The model counts requests.
2. The command's result message carries its request's id.
3. `update` ignores a result whose id is not the latest.

Here `Ledger` is a service whose `balance` can fail with a `LedgerError`:

```ts
import type { Command, Update } from '@roughmagic/oak'
import { Data, Effect } from 'effect'

interface Model {
  readonly balance: number | null
  readonly error: string | null
  /** The id of the latest balance request. */
  readonly balanceRequest: number
}

type Msg = Data.TaggedEnum<{
  BalanceRequested: {}
  BalanceLoaded: { readonly request: number; readonly balance: number }
  BalanceFailed: { readonly request: number; readonly error: string }
}>
const Msg = Data.taggedEnum<Msg>()

const loadBalance = (request: number): Command<Msg, Ledger> =>
  Effect.flatMap(Ledger, (ledger) => ledger.balance).pipe(
    Effect.match({
      onSuccess: (balance) => Msg.BalanceLoaded({ request, balance }),
      onFailure: (error) => Msg.BalanceFailed({ request, error: error.message }),
    }),
  )

const update: Update<Model, Msg, Ledger> = (msg, model) =>
  Msg.$match(msg, {
    BalanceRequested: () => {
      const request = model.balanceRequest + 1
      return { model: { ...model, balanceRequest: request }, commands: [loadBalance(request)] }
    },
    BalanceLoaded: ({ request, balance }) =>
      request === model.balanceRequest
        ? { model: { ...model, balance, error: null }, commands: [] }
        : { model, commands: [] },
    BalanceFailed: ({ request, error }) =>
      request === model.balanceRequest
        ? { model: { ...model, error }, commands: [] }
        : { model, commands: [] },
  })
```

Put the identity of what a result answers in every result message: a request id, a transfer id or a toast id. A keyed subscription can also interrupt the older request, but `update` still needs the check, because a stream can emit after its key has left.

The transfer program in [example-programs](examples/example-programs#the-transfer-flow) uses this guard. Its test gives the fake ledger balance latencies of 3 seconds and then 1 second, so the older response arrives last and `update` ignores it. [example-remote-data](examples/example-remote-data) takes another route: it ignores a new request while one is loading. That fits a refresh the user clicks. It does not fit data that an event makes stale while a request is in flight.

### React

`OakProvider` serves one program to the hooks below it. A React app has one `OakProvider`, as a Redux Toolkit app has one store. Render it once, near the root.

It takes `program`, the value that `makeProgram` returned, and one of two props. The prop says who owns the Effect runtime that runs the program:

| Prop      | Who owns the runtime        | Use it when                                                       |
| --------- | --------------------------- | ----------------------------------------------------------------- |
| `runtime` | The app                     | The app has one runtime, made at module scope or by an Effect app |
| `layer`   | The provider, for one mount | The program depends on props, such as a seed from the server      |

```tsx
<OakProvider program={Counter} runtime={runtime}>
  <App />
</OakProvider>
```

`createOakHooks<Model, Msg>()` returns `{ useSelector, useDispatch }`, typed for the app's program. Call it once at module scope and export the hooks. Both hooks read the `OakProvider` above them, and they throw outside one.

```ts
// hooks.ts
import { createOakHooks } from '@roughmagic/oak-react'
import type { Model, Msg } from './program.js'

export const { useSelector, useDispatch } = createOakHooks<Model, Msg>()
```

- `useSelector(selector)` returns `selector(model)`. The component re-renders when the result changes by `Object.is`.
- `useDispatch()` returns a `dispatch` that sends each message to the program running at that moment. It is the same function on every render while the provider's `program` and `runtime` props stay the same. With a `layer`, it stays the same for the provider's whole life, also when the provider starts its program again.

These rules hold for both props:

- Render builds nothing, because React may render on the server or throw a render away. Render reads `program.init.model` until the program runs, and the live model after. The server always renders `init.model`, so hydration matches.
- The program starts in the commit phase, before any layout or passive effect below the provider runs. A child's `useLayoutEffect` or `useEffect` can dispatch to it.
- After the program stops, `dispatch` does nothing.
- If `update` throws, `dispatch` rethrows the error to its caller, and the model stays unchanged.

#### `runtime`: a runtime that the app owns

Pass a `ManagedRuntime` made at module scope, as in the [Quick start](#quick-start). The provider calls `runtime.runSync(program)` in its layout effect, and the first call builds the layer.

- The layer must build synchronously. To use an async layer, build it before the first render with `await runtime.runtime()`.
- The runtime owns the program. Unmounting the provider, or hiding it in an `<Activity>`, stops nothing. Dispose the runtime to stop the program.

`runtime` also takes a `Runtime.Runtime` whose context already holds the program. This is the escape hatch for an app that runs its own Effect runtime: pass the runtime from `yield* Effect.runtime<…>()` inside the Effect app, or from `Layer.toRuntime(layer)` in a scope that you own. The provider never starts or stops that program. It reads the program from the runtime during render, so the runtime must exist when the provider renders, on the server too.

#### `layer`: a runtime that the provider owns

Pass a layer that provides the program and every service it needs:

```tsx
<OakProvider program={program} layer={program.layer.pipe(Layer.provide(ApiLive))}>
  <App />
</OakProvider>
```

The provider makes a `ManagedRuntime` from the layer when it mounts, runs the program, and disposes the runtime when it stops the program.

- The provider reads `program` and `layer` on its first render only, like an input's `defaultValue`. Both can be built inline. To start over with a new program or layer, change the provider's React `key`.
- Unmounting disposes the runtime, which interrupts the program's commands and subscriptions. `<Activity mode="hidden">` disposes it too, and showing it again starts over from `init`.
- A Suspense boundary above the provider that shows its fallback again does not stop the program.
- React's development replays, such as StrictMode's second run of effects, keep the program. The provider disposes the runtime one microtask after React cleans up its effects, and a replay starts them again before that. StrictMode builds the layer once.

A program in a provider-owned runtime can use the services of an app-wide runtime. Provide the app runtime's context under the program layer, so the app runtime builds its services once and a provider that stops does not dispose them:

```ts
const AppRuntime = ManagedRuntime.make(AppServices)
const appServices = Layer.effectContext(Effect.map(AppRuntime, (runtime) => runtime.context))

const layer = program.layer.pipe(Layer.provide(appServices))
```

The context holds services only. Loggers are FiberRefs, not services, so provide the logger layer again under the program layer.

JSX checks that `runtime` or `layer` provides `program`, and the type error names the program's key. `createElement(OakProvider, props)` compiles without this check. Write `createElement(OakProvider<typeof Counter>, props)` to keep it. The [`@roughmagic/oak-react` README](packages/oak-react/README.md#oakprovider) covers both props in full.

#### Selectors

A selector is a plain function from the model to a value, as in Redux. `useSelector` caches the result per model, so an inline selector is fine. It costs one extra call per render.

A selector that builds an object or an array returns a new reference whenever the model changes, so the component re-renders on every model change. Use the Redux answers, in this order.

Select the smallest values. Call `useSelector` once per value:

```ts
const title = useSelector((m) => m.title)
const mode = useSelector((m) => m.mode)
```

Memoize derived data with reselect. A selector is `(model) => value`, so reselect works unchanged:

```ts
import { createSelector } from 'reselect'

export const selectVisibleTasks = createSelector(
  [(m: Model) => m.tasks, (m: Model) => m.filter],
  (tasks, filter) => (filter === 'all' ? tasks : tasks.filter((t) => t.status === filter)),
)
```

Filter by equality: keep the previous result while the new one is equal. This small wrapper takes any equality, such as Effect's `Equal.equals` on `Data` values:

```ts
import { Data, Equal } from 'effect'

export const keepEqual = <M, A>(selector: (model: M) => A, eq: (a: A, b: A) => boolean) => {
  let last: { readonly value: A } | undefined
  return (model: M): A => {
    const next = selector(model)
    if (last === undefined || !eq(last.value, next)) {
      last = { value: next }
    }
    return last.value
  }
}

export const selectHeader = keepEqual(
  (m: Model) => Data.struct({ title: m.title, mode: m.mode }),
  Equal.equals,
)
```

A memoized selector made at module scope has one cache, shared by every component that uses it. So give `keepEqual` an `eq` that compares everything the view reads. A selector that depends on a prop needs one wrapper per component:

```ts
const select = useMemo(() => keepEqual(selectItem(id), Equal.equals), [id])
const item = useSelector(select)
```

### Several programs

A React app has one `OakProvider`, as a Redux Toolkit app has one store. Put the app's state in one program, as an Elm app has one model. The hooks from `createOakHooks` read that one provider.

Outside React, one Effect runtime can hold several programs, for example in a worker or a test. Each program needs its own key, because the key is its Effect service key:

```ts
const runtime = ManagedRuntime.make(Layer.mergeAll(Counter.layer, Timer.layer))

const counter = runtime.runSync(Counter)
const timer = runtime.runSync(Timer)
```

The key is part of the program's type. `makeProgram('@my-app/Counter', …)` returns a `Program<'@my-app/Counter', Model, Msg, R>`, and a runtime that provides it has `ProgramId<'@my-app/Counter'>` among its services. `ProgramId<K>` is the program's service identifier. It appears in type errors and in declaration files, so import it only to write types. A runtime that lacks the program is a compile error that names the key:

```ts
const timerOnly = ManagedRuntime.make(Timer.layer)
timerOnly.runSync(Counter)
// Type error: Type 'ProgramId<"@my-app/Counter">' is not assignable to type 'ProgramId<"@my-app/Timer">'.
```

A function that takes any program with a given model and messages must be generic in the key. A parameter typed `Program<string, Model, Msg>` accepts only programs whose key is typed `string`:

```ts
// Effect<void, never, ProgramId<K>>
const send = <K extends string>(program: Program<K, Model, Msg>, msg: Msg) =>
  Effect.map(program, (service) => service.dispatch(msg))
```

Use keys of the form `'<package-name>/<ProgramName>'`, such as `'@my-app/Counter'`.

### Server rendering and Next.js

On the server, `OakProvider` renders `program.init.model` and starts nothing. Hydration reads the same model, so the HTML matches. The program starts in the browser after mount, when the provider commits during hydration.

To start from server data, pass the data to a function that makes the program, as Elm passes flags to `init`. These files come from [example-next](examples/example-next), shortened:

```ts
// oak-program/program.ts
export const makeDeskProgram = (model: DeskModel) =>
  makeProgram('@roughmagic/example-next/Desk', {
    init: { model, commands: [] },
    update,
    subscriptions,
  })
```

The seed crosses from the server to the client, so it must be plain data. `Data.case`, `Data.struct` and `Data.taggedEnum` values throw in React's serializer. An `Option` arrives as a plain object that fails `Option.isOption`. The desk model is plain readonly objects, so the seed carries it as it is. A model of `Data` values needs a function that builds it from the plain seed, called inside `makeDeskProgram`.

A Server Component loads the seed and renders a client component:

```tsx
// app/desks/[desk]/page.tsx
import { DeskClient } from '@/components/desk-client'
import { coerceDesk, loadDeskSeed, type DeskSearchParams } from '@/lib/server-seed'

export default async function DeskPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly desk: string }>
  readonly searchParams: Promise<DeskSearchParams>
}) {
  const { desk } = await params
  const seed = await loadDeskSeed({ desk: coerceDesk(desk), searchParams: await searchParams })
  return <DeskClient key={seed.seedKey} seed={seed} />
}
```

```tsx
// components/desk-client.tsx
'use client'

import { OakProvider } from '@roughmagic/oak-react'
import { Layer } from 'effect'
import type { ReactElement } from 'react'
import type { DeskSeed } from '@/lib/server-seed'
import { DeskApiLive, makeDeskProgram } from '@/oak-program'
import { DeskView } from './desk-view'

export function DeskClient({ seed }: { readonly seed: DeskSeed }): ReactElement {
  // The seed differs per page, so each mount makes its own program. The provider reads program
  // and layer on its first render only, and owns one runtime for this mount.
  const program = makeDeskProgram(seed.initialModel)
  return (
    <OakProvider program={program} layer={program.layer.pipe(Layer.provide(DeskApiLive))}>
      <DeskView seed={seed} />
    </OakProvider>
  )
}
```

- Put `'use client'` on the component that a Server Component renders, here `DeskClient`. The files it imports become client code too.
- A Server Component must not import values from `@roughmagic/oak-react`. The package calls `createContext` when it loads, and React's server build has no `createContext`. Type imports are fine.
- The `layer` prop makes the provider own a runtime for this mount. The provider reads `program` and `layer` on its first render only, so a later render's new program and layer change nothing. Unmounting disposes the runtime, which interrupts the program's commands and subscriptions.
- In development, StrictMode runs the provider's effects twice. The second run keeps the running program, so the layer builds once and the program starts once from the seed.

A program lives as long as the client component that mounts it. Choose where to mount it:

- In a page, as above. Each page mount makes a new program from its own seed. Navigating away unmounts it and interrupts its pending commands and subscriptions. The `key` makes a new seed remount the client component, and so start a new program. [example-next](examples/example-next) works this way.
- In the root layout. Next.js keeps a layout's client state across navigation, so the program keeps running. Mount it there when in-flight work must survive navigation, such as a transaction watcher or a toast timer. When the provider wraps `{children}` from a layout, each component that calls the hooks needs its own `'use client'`. Children passed from a Server Component are not imported by the provider, so they do not become client code through it.

The seed is read once. `router.refresh()` and `revalidatePath` render the Server Component again and pass new props, but the running program keeps its model. Fresh data reaches the program through commands. To start over from a new seed, change the client component's `key`.

Read data through a service in the program layer, for example one that fetches a Route Handler.

### Defects and logging

Errors are values: a command turns its errors into messages. A defect is a bug. Oak logs every defect at Error level through Effect's `Logger`. The log carries the `Cause` and two annotations: `oak.program`, the program's key, and `oak.source`. You handle defects by providing a Logger under the program layer.

| `oak.source`   | Defect                                                                                 | What happens next                                    |
| -------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `update`       | `update` throws on a message from a command or a stream                                | The model stays unchanged. A stream keeps running    |
| `listener`     | A model listener throws                                                                | The other listeners still run                        |
| `command`      | A command dies, or ends by interruption while the program is open                      | Its message is never sent                            |
| `subscription` | A stream dies, or ends by interruption while its key is wanted and the program is open | It stays stopped until its key leaves and comes back |
| `subscription` | `subscriptions` throws                                                                 | The running streams are left alone                   |

Defects stay contained: nothing else stops, and the program keeps running. A throw from `update` on a message that your code dispatches is not a defect that Oak logs. `dispatch` rethrows it to your code. See [Dispatch rules](#dispatch-rules).

Closing the program's scope logs nothing, and neither does retiring a stream whose key left. A finalizer that dies during either is a defect, and Oak logs it.

Provide loggers, tracers, config and `TestContext` under the program layer, as you provide services:

```ts
const runtime = ManagedRuntime.make(
  Jokes.layer.pipe(Layer.provide(Layer.mergeAll(JokeServiceLive, Logger.pretty))),
)
```

The program captures its runtime when its layer builds. Commands, subscriptions and defect logs run on that runtime.

Effect's default logger writes logfmt lines with `console.log`. In a browser, `Logger.pretty` is easier to read. To send defects to an error tracker, add a logger that reads the annotations. Here `track` stands for your tracker's client:

```ts
import { Cause, HashMap, Layer, Logger, ManagedRuntime, Option } from 'effect'

const oakDefects = Logger.make(({ message, annotations, cause }) => {
  const program = HashMap.get(annotations, 'oak.program')
  const source = HashMap.get(annotations, 'oak.source')
  if (Option.isSome(program) && Option.isSome(source)) {
    track(String(message), {
      program: program.value,
      source: source.value,
      cause: Cause.pretty(cause),
    })
  }
})

const runtime = ManagedRuntime.make(
  Jokes.layer.pipe(Layer.provide(Layer.mergeAll(JokeServiceLive, Logger.add(oakDefects)))),
)
```

### Testing

Here are four recipes, from the cheapest to the most complete.

`update` is pure. Call it with a message and a model:

```ts
it('Fetch marks the model pending and returns one command', () => {
  const { model, commands } = update(Msg.Fetch(), initialModel)
  expect(model.pending).toBe(true)
  expect(commands).toHaveLength(1)
})
```

`subscriptions` is pure too. Compare the keys:

```ts
it('keys the ticker by its interval', () => {
  const keys = (model: Model) => subscriptions(model).map((sub) => sub.key)
  expect(keys({ running: true, intervalMs: 250, ticks: 9 })).toEqual(['tick:250'])
  expect(keys({ running: false, intervalMs: 250, ticks: 9 })).toEqual([])
})
```

A command is an `Effect`. Take it from `commands`, provide a fake service, and run it:

```ts
it('turns a failed fetch into Failed', async () => {
  const [command] = update(Msg.Fetch(), initialModel).commands
  const down = Layer.succeed(
    JokeService,
    JokeService.of({ fetchJoke: Effect.fail(new JokeError({ message: 'HTTP 503' })) }),
  )
  expect(await Effect.runPromise(Effect.provide(command, down))).toEqual(
    Msg.Failed({ error: 'HTTP 503' }),
  )
})
```

Run a whole program on Effect's `TestClock`, with a fake service that sleeps on Effect's `Clock`:

```ts
const JokeServiceFake = (joke: string) =>
  Layer.succeed(
    JokeService,
    JokeService.of({ fetchJoke: Effect.as(Effect.sleep('1 second'), joke) }),
  )

it('shows the joke after the fake latency', () =>
  Effect.gen(function* () {
    const { state, dispatch } = yield* Jokes
    dispatch(Msg.Fetch())
    yield* TestClock.adjust('1 second')
    expect(state.value.joke).toBe('A fake joke')
  }).pipe(
    Effect.provide(Jokes.layer),
    Effect.provide(JokeServiceFake('A fake joke')),
    Effect.provide(TestContext.TestContext),
    Effect.runPromise,
  ))
```

- `TestContext` comes last in the chain, so it sits under the program and under every fake. The program captures its runtime when its layer builds, so its commands, its subscriptions and the fakes all sleep on the `TestClock`.
- `Effect.provide` builds a new program for this test and closes its scope when the test ends. That interrupts whatever still runs.
- Under `TestContext` the clock starts at 0. `TestClock.adjust` lets other fibers run before and after each wake-up, so the test needs no extra waits.

## Packages

| Package                 | Description                                            |                                        |
| ----------------------- | ------------------------------------------------------ | -------------------------------------- |
| `@roughmagic/oak`       | Programs, commands and subscriptions, built on Effect. | [README](packages/oak/README.md)       |
| `@roughmagic/oak-react` | React bindings: `OakProvider`, `createOakHooks`.       | [README](packages/oak-react/README.md) |

## Examples

| Example                                               | Shows                                                                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`example-react`](examples/example-react)             | A Vite app with three dice. A roll is a command that uses an Effect service, and auto-roll is a keyed subscription. `Data.case` models and `@fp-ts/optic` lenses.       |
| [`example-next`](examples/example-next)               | Next.js App Router. A Server Component seeds the program, each page mount runs its own program in a runtime that the provider owns, and reselect memoizes derived data. |
| [`example-remote-data`](examples/example-remote-data) | Keyed remote data with stale-while-revalidate records, with tests for `update`, the fetch command and the whole program.                                                |
| [`example-programs`](examples/example-programs)       | Five programs without a UI, each with tests. See the list below.                                                                                                        |

The programs in `example-programs`:

- `CounterProgram`: messages and `update` only.
- `RandomProgram`: a delayed command that reads Effect's `Random` service.
- `TimerProgram`: a keyed subscription. A new interval restarts the ticker.
- `JokeProgram`: a command that uses an Effect service and turns its failure into a message.
- `TransferProgram`: submit a transfer, watch it until it settles, show a toast, then refetch the balance. Balance, settle and toast results carry ids, and `update` ignores stale ones.

## Requirements

- TypeScript 5.4 or newer, with `strict` enabled. `makeProgram` uses `NoInfer`, which TypeScript 5.4 added.
- `effect` 3.22.2 or a later 3.x release.
- React 19, for `@roughmagic/oak-react`.

## Development

The repository is a pnpm workspace with Turborepo. The examples read the Oak packages from their `dist` folders, and the `dev` task does not build them, so run `pnpm build` before `pnpm dev`.

```sh
pnpm install
pnpm build                                   # build every package and example
pnpm test                                    # run every test suite
pnpm test --filter=@roughmagic/oak           # test one package
pnpm dev --filter=@roughmagic/example-next   # run one example
pnpm lint
pnpm format
```

## License

[MIT](LICENSE)
