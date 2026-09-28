# `@roughmagic/oak-react`

React bindings for [`@roughmagic/oak`](https://github.com/roughmagic/oak/tree/main/packages/oak).

## Installation

```sh
npm install @roughmagic/oak-react @roughmagic/oak effect react
```

## Example

```ts
// counter.ts
import { makeProgram, type Update } from '@roughmagic/oak'
import { Data } from 'effect'

export interface Model {
  readonly count: number
}

export type Msg = Data.TaggedEnum<{ Increment: {} }>
export const Msg = Data.taggedEnum<Msg>()

const update: Update<Model, Msg> = (msg, model) =>
  Msg.$match(msg, {
    Increment: () => ({ model: { count: model.count + 1 }, commands: [] }),
  })

export const Counter = makeProgram('@my-app/Counter', {
  init: { model: { count: 0 }, commands: [] },
  update,
})
```

```ts
// hooks.ts
import { createOakHooks } from '@roughmagic/oak-react'
import type { Model, Msg } from './counter.js'

export const { useSelector, useDispatch } = createOakHooks<Model, Msg>()
```

```tsx
// app.tsx
import { OakProvider } from '@roughmagic/oak-react'
import { ManagedRuntime } from 'effect'
import { Counter, Msg } from './counter.js'
import { useDispatch, useSelector } from './hooks.js'

const runtime = ManagedRuntime.make(Counter.layer)

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

## `OakProvider`

`OakProvider` serves one program to the hooks below it. A React app has one `OakProvider`, as a Redux app has one store. Render it once, near the root.

It takes `program`, the value `makeProgram` returned, and one of two props. The prop says who owns the Effect runtime that runs the program:

| Prop      | Who owns the runtime        | Use it when                                                       |
| --------- | --------------------------- | ----------------------------------------------------------------- |
| `runtime` | The app                     | The app has one runtime, made at module scope or by an Effect app |
| `layer`   | The provider, for one mount | The program depends on props, such as a seed from the server      |

```tsx
<OakProvider program={Counter} runtime={runtime}>{children}</OakProvider>
<OakProvider program={Counter} layer={Counter.layer}>{children}</OakProvider>
```

These rules hold for both props:

- Render builds nothing, because React may render on the server or throw a render away. Render reads `program.init.model` until the program runs, and the live model after. The server always renders `init.model`, so hydration matches.
- The program starts in the commit phase, before any layout or passive effect below the provider runs. A child's `useLayoutEffect` or `useEffect` can dispatch to it.
- After the program stops, `dispatch` does nothing.
- If `update` throws, `dispatch` rethrows the error to its caller, and the model stays unchanged.

### `runtime`: a `ManagedRuntime` that the app owns

Make the runtime at module scope, from a layer that provides the program, as in the [example](#example). The provider calls `runtime.runSync(program)` in its layout effect, and the first call builds the layer.

- When `runSync` returns, synchronous `init` commands and their synchronous follow-ups have already run. React renders their result right after the first commit.
- `runSync` needs a layer that builds synchronously. To use an async layer, build it before the first render:

  ```ts
  await runtime.runtime()
  createRoot(element).render(<App />)
  ```

- The runtime owns the program. StrictMode builds it once. Unmounting the provider, or hiding it in an `<Activity>`, stops nothing. A remount renders the live model on its first render. Dispose the runtime to stop the program.
- If the program started another way, for example from code outside React, the first render shows `init.model`. React renders the live model right after.
- A new `runtime` or `program` value switches the provider to that pair and starts it. The old program keeps running.

### `runtime`: a `Runtime` that already runs the program

This is the escape hatch for an app that runs its own Effect runtime. Pass any `Runtime.Runtime` whose context holds the program, for example:

- `yield* Effect.runtime<…>()` inside an Effect app that provides `program.layer`;
- `Layer.toRuntime(layer)` in a scope that you own;
- `await managed.runtime()` from a `ManagedRuntime`;
- the runtime of a test.

```tsx
const main = Effect.gen(function* () {
  const runtime = yield* Effect.runtime<Context.Tag.Identifier<typeof Counter>>()
  createRoot(element).render(
    <OakProvider program={Counter} runtime={runtime}>
      <App />
    </OakProvider>,
  )
  yield* Effect.never
})

Effect.runFork(main.pipe(Effect.provide(Counter.layer)))
```

The provider never starts or stops the program. A client render reads the live model from the first render on. The server renders `init.model`, as always, and hydration reads `init.model` to match it. The provider reads the program from the runtime during render, so the runtime must exist when the provider renders, on the server too.

### `layer`: a runtime that the provider owns

Pass a layer that provides the program and every service it needs:

```tsx
<OakProvider program={program} layer={program.layer.pipe(Layer.provide(ApiLive))}>
  {children}
</OakProvider>
```

The provider makes a `ManagedRuntime` from the layer in its layout effect and runs the program. When React cleans up the provider's effects, the provider disposes the runtime one microtask later, unless React starts the effects again first.

- The provider reads `program` and `layer` on its first render only, like an input's `defaultValue`. Later values change nothing, so both can be built inline. To start over with a new program or layer, change the provider's React `key`.
- Unmounting disposes the runtime, which interrupts the program's commands and subscriptions. This includes an error boundary that removes the provider.
- `<Activity mode="hidden">` disposes the runtime too. Showing it again makes a new runtime, and the program starts over from `init`. A provider that mounts inside a hidden `<Activity>` builds nothing until it is shown. To keep a program running while hidden, pass a `runtime` made above the `<Activity>`.
- A Suspense boundary above the provider that shows its fallback again does not stop the program. When a sibling suspends on the first mount, nothing builds until the tree commits.
- In development, React replays effects: under StrictMode on mount, and when a Suspense boundary or an `<Activity>` shows its content again. A replay cleans up the provider's effects and runs them again in one task. The provider keeps the running program across a replay, so StrictMode builds the layer once and runs the `init` commands once. A child's `useLayoutEffect` still runs twice, against the same program.
- The layer must build synchronously.

A program in a provider-owned runtime can use the services of an app-wide runtime. Provide the app runtime's context under the program layer. The app runtime builds its services once, and a provider that stops does not dispose them:

```ts
const AppRuntime = ManagedRuntime.make(AppServices)
const appServices = Layer.effectContext(Effect.map(AppRuntime, (runtime) => runtime.context))

const layer = program.layer.pipe(Layer.provide(appServices))
```

The context holds services only. Loggers are FiberRefs, not services, so provide the logger layer again under the program layer. `AppServices` must build synchronously too, or be built before the first render with `await AppRuntime.runtime()`.

### Types

JSX checks that `runtime` or `layer` provides `program`. The type error names both keys:

```
Type 'ManagedRuntime<ProgramId<"@my-app/Other">, never>' is not assignable to type 'ManagedRuntime<ProgramId<"@my-app/Counter">, unknown> | Runtime<ProgramId<"@my-app/Counter">>'.
```

`createElement(OakProvider, props)` compiles without this check. Write `createElement(OakProvider<typeof Counter>, props)` to keep it.

## `createOakHooks<Model, Msg>()`

Returns `{ useSelector, useDispatch }`, typed for the app's program. Call it once at module scope. Both hooks read the `OakProvider` above them and throw outside one.

- `useSelector(selector)` returns `selector(model)`. The component re-renders when the result changes by `Object.is`.
- `useDispatch()` returns a `dispatch` that sends each message to the program running at that moment. It is the same function on every render while the provider's `program` and `runtime` props stay the same. With a `layer`, it stays the same for the provider's whole life, also when the provider starts its program again. `dispatch` runs `update` before it returns. If `update` throws, `dispatch` rethrows. After the program stops, `dispatch` does nothing.

### Selectors

A selector is a plain function from the model to a value, as in Redux. `useSelector` caches its result per model, so React sees the same value until the model changes. Inline selectors are fine: the component subscribes once, and a new selector costs one extra call per render.

A selector that builds an object returns a new reference whenever the model changes. Select smaller values or memoize the selector when a component should skip those renders:

```ts
// Select the smallest value. Call useSelector once per value.
const count = useSelector((m) => m.count)
const label = useSelector((m) => m.label)
```

```ts
// Memoize derived data with reselect.
import { createSelector } from 'reselect'

export const selectVisibleTasks = createSelector(
  [(m: Model) => m.tasks, (m: Model) => m.filter],
  (tasks, filter) => (filter === 'all' ? tasks : tasks.filter((t) => t.status === filter)),
)
```

```ts
// Keep the previous result while the new one is equal.
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

A wrapper made at module scope has one cache, shared by every component that uses it. Give it an `eq` that compares everything the view reads. A selector that depends on a prop needs one wrapper per component:

```ts
const select = useMemo(() => keepEqual(selectItem(id), Equal.equals), [id])
const item = useSelector(select)
```

## Next.js

Use the `layer` prop, so each page mount owns its program. This client component comes from [example-next](https://github.com/roughmagic/oak/tree/main/examples/example-next). `makeDeskProgram(model)` makes a program whose first model is the server's seed, and `DeskApiLive` provides the service that its commands use:

```tsx
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

- Put `'use client'` on the component that a Server Component renders, such as `DeskClient` above. The files it imports become client code too.
- A Server Component must not import values from `@roughmagic/oak-react`. The package calls `createContext` when it loads, and React's server build has no `createContext`. Type imports are fine.
- The server renders `program.init.model` and starts nothing. The program starts in the browser, when the provider commits during hydration.
- The provider ignores a new seed on a later render. Render `DeskClient` with a new `key` to start over from a new seed. The remount disposes the old runtime.
- When the provider wraps `{children}` from a layout, each component that calls the hooks needs its own `'use client'`. Children passed from a Server Component are not imported by the provider, so they do not become client code through it.
