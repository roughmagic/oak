# `@roughmagic/oak`

[The Elm Architecture](https://guide.elm-lang.org/architecture/) for TypeScript, built on Effect. `update` is a pure function, commands are `Effect`s, subscriptions are `Stream`s, and a running program is an Effect service provided by a `Layer`.

For React, use [`@roughmagic/oak-react`](https://github.com/roughmagic/oak/tree/main/packages/oak-react). The [guide](https://github.com/roughmagic/oak#guide) covers commands, services, subscriptions and testing in depth.

## Installation

```sh
npm install @roughmagic/oak effect
```

## Example

```ts
import { makeProgram, type Update } from '@roughmagic/oak'
import { Data, Effect, ManagedRuntime } from 'effect'

interface Model {
  readonly count: number
}

type Msg = Data.TaggedEnum<{
  Increment: {}
  IncrementLater: {}
}>
const Msg = Data.taggedEnum<Msg>()

const update: Update<Model, Msg> = (msg, model) =>
  Msg.$match(msg, {
    Increment: () => ({ model: { count: model.count + 1 }, effects: [] }),
    IncrementLater: () => ({
      model,
      effects: [Effect.as(Effect.sleep('1 second'), Msg.Increment())],
    }),
  })

const Counter = makeProgram('@my-app/Counter', {
  init: { model: { count: 0 }, effects: [] },
  update,
})

const runtime = ManagedRuntime.make(Counter.layer)
const { state, dispatch } = runtime.runSync(Counter)

state.subscribe((model) => console.log(model.count))
dispatch(Msg.IncrementLater()) // logs 1 after one second
```

## API

### `makeProgram(key, config)`

| Argument               | Type                       |                                                                   |
| ---------------------- | -------------------------- | ----------------------------------------------------------------- |
| `key`                  | `K extends string`         | Effect service key, such as `'@my-app/Counter'`                   |
| `config.init`          | `NextModel<M, Msg, R>`     | The first model and the commands to run at startup (Elm's `init`) |
| `config.update`        | `Update<M, Msg, R>`        | Returns the next model and the commands to run                    |
| `config.subscriptions` | `Subscriptions<M, Msg, R>` | Optional. The streams that the current model asks for             |

`R` is the set of services the whole program uses, in its commands and its subscriptions. TypeScript infers it when the program uses one service. A program that uses more than one service annotates `update` with the union of all of them, such as `Update<Model, Msg, Api | Ledger>`; `init` and `subscriptions` then check against that union. Oak takes `Msg` from the parameter of `update`, never from the messages that commands or streams yield.

`makeProgram` returns a `Program<K, M, Msg, R>`. The program is the `Context.Tag` of its `ProgramService`, so `runtime.runSync(program)` and `yield* program` return the service. It adds two fields to the tag:

- `init`: the `init` you passed. A view can render `program.init.model` before the program starts.
- `layer`: a scoped `Layer` that runs the program. It requires `R` without `Scope`, because each command and each stream run gets its own `Scope`. Building it forks the `init` commands and starts the subscriptions. Closing its scope stops dispatch, then interrupts every running command and subscription.

### Keys and `ProgramId<K>`

The key identifies the program. Programs with different keys can run side by side in one runtime. Each program in a runtime needs its own key. Use keys of the form `'<package-name>/<ProgramName>'`.

`ProgramId<K>` is the program's service identifier. A runtime that provides the program has `ProgramId<'@my-app/Counter'>` among its services. A runtime that lacks the program is a compile error that names the key:

```ts
const runtime = ManagedRuntime.make(Other.layer)
runtime.runSync(Counter)
// Type error: Type 'ProgramId<"@my-app/Counter">' is not assignable to type 'ProgramId<"@my-app/Other">'.
```

`ProgramId` appears in type errors and in declaration files. Import it only to write types.

A key typed `string` or as a template type, such as `` `@my-app/Desk/${string}` ``, gives the compiler nothing to tell programs apart.

A function that takes any program with a given model and messages must be generic in the key. A parameter typed `Program<string, Model, Msg>` accepts only programs whose key is typed `string`:

```ts
// Effect<void, never, ProgramId<K>>
const send = <K extends string>(program: Program<K, Model, Msg>, msg: Msg) =>
  Effect.map(program, (service) => service.dispatch(msg))
```

### `ProgramService<M, Msg>`

- `state.value`: the current model.
- `state.subscribe(listener)`: calls `listener(model)` after each model change. It returns a function that removes the listener.
- `dispatch(msg)`: sends a message. See [Dispatch](#dispatch). It is declared with `this: void`, so you can destructure it and pass it as a callback.

### Types

- `Command<Msg, R>`: `Effect<Msg, never, R>`. A command always yields a message. See [Commands](#commands).
- `NextModel<M, Msg, R>`: `{ model: M, effects: ReadonlyArray<Command<Msg, R>> }`. `effects` is required. `effects: []` is Elm's `Cmd.none`.
- `Update<M, Msg, R>`: `(msg: Msg, model: M) => NextModel<M, Msg, R>`.
- `Subscription<Msg, R>`: `{ key: string, stream: Stream<Msg, never, R> }`.
- `Subscriptions<M, Msg, R>`: `(model: M) => ReadonlyArray<Subscription<Msg, R>>`.
- `OakState<M>`: `{ value: M, subscribe(listener): () => void }`.
- `ProgramId<K>`: the service identifier of the program with key `K`. See [Keys](#keys-and-programidk).

## Runtimes

Oak is a layer. Add `program.layer` to any runtime, built the way you want: `ManagedRuntime.make`, `Layer.toRuntime` in your own scope, `Effect.provide` in a test, or `Layer.launch`. You configure the runtime: services, loggers, tracers and config.

With a `ManagedRuntime`, the first `runtime.runSync(program)` builds the layer. When it returns, synchronous `init` commands and their synchronous follow-ups have already run and been dispatched, because Effect flushes its synchronous scheduler before `runSync` returns. They still never run inside a `dispatch`.

## Update

`update` is pure and never mutates the model. A change returns a new model, with new objects along the path to every changed field. A message that changes nothing may return the same model. Oak compares models with `Object.is`, so it then notifies nobody.

## Dispatch

`dispatch(msg)` is one synchronous step:

1. Oak calls `update(msg, model)`.
2. Oak stores the returned model and calls each model listener with it.
3. Oak schedules the returned commands on the program's runtime.

When `dispatch` returns, `state.value` holds the new model. Calls from one event handler run in call order.

If `update` throws, `dispatch` rethrows the error to its caller and nothing changes: the model stays, no listener runs, no command starts, and Oak logs nothing. The next `dispatch` works. Redux treats a reducer that throws the same way.

`update` and model listeners may not dispatch. A `dispatch` made while another dispatch runs throws an `Error`. Nothing can listen for messages: code can only observe the model. A dispatch from `update` throws inside `update`, so the error comes out of the outer `dispatch`. A listener that throws, for this or any other reason, is a `listener` defect: Oak logs it, and the other listeners still run.

Messages from commands and subscriptions arrive later, each in its own dispatch, in no guaranteed order. Every command and stream starts on Effect's scheduler, never inside the dispatch that caused it. Even `Effect.succeed(msg)` lands after the dispatch that returned it. These dispatches have no caller to throw to. If `update` throws on such a message, Oak logs an `update` defect and keeps running.

After the program's scope closes, `dispatch` does nothing.

## Commands

A command always returns a message, like Elm's `Cmd msg`. Its type is `Command<Msg, R>`, which is `Effect<Msg, never, R>`. Turn failures into messages with `Effect.match` or `Effect.catchAll`, so the model can hold the error.

Oak runs each command in its own fiber and dispatches the message it yields. While the program runs, a command that ends without a message is a defect. That happens in two ways:

- The command dies, from a thrown exception or `Effect.die`.
- The command ends by an interruption from its own work: it awaits an interrupted `Deferred`, takes from a `Queue` that shuts down, joins an interrupted fiber, or calls `Effect.interrupt`.

Oak logs the defect and sends no message. The program keeps running. Only Oak holds a command's fiber, so only closing the program's scope interrupts a command from outside. That interruption is silent.

A command can catch an interruption from its own work and turn it into a message:

```ts
Queue.take(inbox).pipe(
  Effect.map((item) => Msg.Received({ item })),
  Effect.catchAllCause((cause) =>
    Cause.isInterruptedOnly(cause) ? Effect.succeed(Msg.InboxClosed()) : Effect.failCause(cause),
  ),
)
```

Each command runs in its own `Scope`. Oak closes it when the command ends and before it dispatches the message. So a resource from `Effect.acquireRelease` is released, and a fiber from `Effect.forkScoped` is interrupted. A resource that should live as long as the program belongs in a service layer or a subscription.

## Subscriptions

The key names every model value the stream reads, and nothing else. Oak runs only the stream from the call where its key first appeared. A value missing from the key goes stale; a value in the key restarts the stream when it changes.

```ts
// Wrong: the account changes, the key does not, and the old poll keeps running.
{ key: 'balance', stream: pollBalance(model.account) }
// Right
{ key: `balance:${model.account}`, stream: pollBalance(model.account) }
```

If a stream needs data that changes often and should not restart it, emit a plain message and read the current model in `update`.

- Equal keys are one subscription. Oak runs it once.
- Each run has its own `Scope`, closed when the run ends.
- A stream that completes keeps its key. It runs again only after the key leaves and comes back.
- Oak interrupts a stream silently when its key leaves and when the program's scope closes.
- A stream that dies, or that ends by an interruption from its own work while its key is wanted, is a defect. Oak logs it, and the stream stays stopped until its key leaves and comes back.
- A key that comes back starts its new stream after the previous run has finished, finalizers included.
- Oak reconciles against the latest model only. A key that leaves and returns before Oak reconciles does not restart its stream. This happens when the key leaves and returns within one synchronous burst of dispatches, or through a synchronous command.
- A message can arrive after its key has left. `update` must accept messages for things that are gone.

`Stream.fromQueue(queue)` completes when the queue shuts down, so it keeps its key and Oak logs nothing. `Stream.repeatEffect(Queue.take(queue))` is interrupted when the queue shuts down, so Oak logs it as a defect.

To restart a stream on demand, put a counter in its key and increment the counter in `update`:

```ts
{ key: `socket:${model.generation}`, stream: openSocket(model.url) }
```

## Defects

Errors are values: a command turns its errors into messages. A defect is a bug. Oak logs every defect at Error level through Effect's `Logger`, with the `Cause` and two log annotations: `oak.program`, the program's key, and `oak.source`. You handle defects by providing a Logger under the program layer.

| `oak.source`   | Defect                                                                                 | What happens next                                    |
| -------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `update`       | `update` throws on a message from a command or a stream                                | The model stays unchanged. A stream keeps running    |
| `listener`     | A model listener throws                                                                | The other listeners still run                        |
| `command`      | A command dies, or ends by interruption while the program is open                      | Its message is never sent                            |
| `subscription` | A stream dies, or ends by interruption while its key is wanted and the program is open | It stays stopped until its key leaves and comes back |
| `subscription` | `subscriptions` throws                                                                 | The running streams are left alone                   |

Defects stay contained: nothing else stops, and the program keeps running. A throw from `update` on a message that your code dispatches is not a defect that Oak logs. `dispatch` rethrows it to your code. See [Dispatch](#dispatch).

Closing the program's scope logs nothing, and neither does retiring a stream whose key left. A finalizer that dies during either is a defect, and Oak logs it.

## Where to provide loggers and services

Provide services, loggers, tracers, config and `TestContext` _under_ the program layer:

```ts
const runtime = ManagedRuntime.make(
  Counter.layer.pipe(Layer.provide(Layer.mergeAll(AppServices, Logger.pretty))),
)
```

The program captures its runtime when its layer builds. Commands, subscriptions and defect logs run on that runtime.

Effect's default logger writes logfmt lines with `console.log`. In a browser, `Logger.pretty` is easier to read.
