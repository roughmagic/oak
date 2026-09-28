# `@roughmagic/example-programs`

Five Oak programs without a UI. Each program has its own folder under `src/` and one test file under `test/`. The tests show three ways to test an Oak program: call `update` directly, check the subscription keys, and run the whole program on Effect's `TestClock`.

## Programs

| Program           | Folder         | Shows                                                                                                           |
| ----------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| `CounterProgram`  | `src/counter`  | Messages and `update` only. `dispatch` stores the next model before it returns.                                 |
| `RandomProgram`   | `src/random`   | A delayed command. It reads Effect's `Random` service, so a test can fix the number.                            |
| `TimerProgram`    | `src/timer`    | A keyed subscription. A new interval changes the key, and the key change restarts the ticker.                   |
| `JokeProgram`     | `src/jokes`    | A command that uses an Effect service. The command turns the service's typed failure into a message.            |
| `TransferProgram` | `src/transfer` | The full flow: submit a transfer, watch it until it settles, show a toast, then refetch the balance. See below. |

Each program's key is `@roughmagic/example-programs/<Name>`, for example `@roughmagic/example-programs/Counter`.

## Models

Each model is a `Data.case` value, and `update` changes it through `@fp-ts/optic` lenses. Optic's `at` copies the model into a plain object, and the copy loses the structural equality of `Data.case`. `caseIso(X)` in `src/optic.ts` passes each copy back through the constructor `X`. A lens composes `caseIso(X)` at each `Data.case` value on its path. No lens here reaches into a nested `Data.case` value, so each lens starts from `caseIso(Model)`:

```ts
const _count = caseIso(CounterModel).at('count')

Increment: () => ({ model: Optic.modify(_count)((n) => n + 1)(model), effects: [] }),
```

The next model is still a `Data.case` value, so `Equal.equals(model, CounterModel({ count: 1 }))` holds. The dice model in [example-react](../example-react/src/oak-program/optics.ts) is nested, and its lenses compose `caseIso` at every level.

## Running a program

A program's layer requires the services that its commands and subscriptions use. Provide them under the layer:

```ts
import { Layer, ManagedRuntime } from 'effect'
import { JokeMsg, JokeProgram, JokeServiceLive } from './src/jokes/index.js'

const runtime = ManagedRuntime.make(JokeProgram.layer.pipe(Layer.provide(JokeServiceLive)))
const { state, dispatch } = runtime.runSync(JokeProgram)

state.subscribe((model) => console.log(model.joke))
dispatch(JokeMsg.Fetch())
```

## The transfer flow

`TransferProgram` uses a `Ledger` service with three operations: `submit`, `status` and `balance`. `FakeLedger(options)` implements it in memory. The options set the submit latency, the delay before a transfer settles and the latency of each balance call. The fake keeps time with Effect's `Clock`.

1. `init` issues the first balance request. The first model is already in the loading state.
2. `TransferRequested` submits a transfer. The program runs one transfer at a time and ignores a request while another runs. `Submitted` stores the transfer id that the ledger returns.
3. While a transfer is pending, a subscription with the key `watch:<id>` polls its status once a second. The stream reads only the id, so the key names only the id.
4. `Settled` returns to idle, shows a toast and refetches the balance. It chains the steps `idle`, `showToast` and `requestBalance` with `andThen`, Elm's helper that keeps the commands of both steps. `requestBalance(model)` is the same pure helper that `BalanceRequested` calls. `Settled` does not dispatch a message to itself.
5. The toast expires through a delayed command. The timer starts once, when the toast appears, and nothing needs to stop it, so a subscription would add nothing.

A result can arrive after the model has moved on. Each result is safe for one of two reasons.

It carries the id of what it answers, and `update` ignores it when the id no longer matches the model:

- Balance requests: the model counts requests. `BalanceLoaded` and `BalanceFailed` carry their request's id, so a slow, older response that arrives after a newer one changes nothing.
- Toasts: the model assigns toast ids. When the user dismisses a toast, its timer still fires, and the `ToastExpired` for the missing toast changes nothing.
- Transfers being watched: `Settled` applies only to the pending transfer with that id.

Or at most one is in flight:

- Submits: `TransferRequested` is ignored unless the transfer is idle, so at most one submit is in flight. `Submitted` and `SubmitFailed` therefore need no id, as `Received` needs none in [example-remote-data](../example-remote-data).

## Tests

- `update` is pure. A test calls it with a message and a model and compares the result.
- `subscriptions` is pure too. A test calls it with a model and compares the keys.
- A whole-program test runs the program on the `TestClock`:

```ts
it('shows the joke from the service after its latency', () =>
  Effect.gen(function* () {
    const { state, dispatch } = yield* JokeProgram
    dispatch(JokeMsg.Fetch())
    yield* TestClock.adjust('1 second')
    expect(state.value.joke).toBe('A fake joke')
  }).pipe(
    Effect.provide(JokeProgram.layer),
    Effect.provide(JokeServiceFake('A fake joke')),
    Effect.provide(TestContext.TestContext),
    Effect.runPromise,
  ))
```

`TestContext` comes last in the chain, so it sits under the program and under every fake. The program captures its runtime when its layer builds. Its commands, its subscriptions and the fakes they call then all sleep on the `TestClock`. Under `TestContext` the clock starts at 0. `TestClock.adjust` lets other fibers run before and after each wake-up, so the tests need no extra waits.

The test "keeps the latest balance when an older, slower response arrives last" gives the fake balance latencies of 3 seconds and then 1 second. The first response therefore arrives last, and the test checks that `update` ignores it.

## Scripts

```sh
pnpm run build   # type-check src and test
pnpm run test    # run the tests
```
