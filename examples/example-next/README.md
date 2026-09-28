# `@roughmagic/example-next`

A Next.js App Router app that starts an Oak program from server data.

Run it from the repo root. Next.js reads the Oak packages from their `dist` folders, and Turbo's `dev` task does not build them, so build once first:

```sh
pnpm build --filter=@roughmagic/example-next
pnpm dev --filter=@roughmagic/example-next
```

## How it works

- A Server Component reads the route and the search params and builds a seed (`lib/server-seed.ts`). The seed is `{ seedKey, initialModel, navigation }`. It crosses from the server to the client, so it holds plain data only. `Data` values throw in React's serializer, and an `Option` arrives as a plain object.
- `DeskClient` (`components/desk-client.tsx`) is the `'use client'` boundary. It calls `makeDeskProgram(seed.initialModel)`, so the seed is the program's first model. It renders the app's one `OakProvider` and passes `program.layer`, with `DeskApiLive` provided under it, to the provider's `layer` prop. The provider therefore makes a runtime for each mount. It reads `program` and `layer` on its first render only.
- The server renders the seed model and starts nothing. The program starts in the browser, when the provider commits during hydration. In development, StrictMode runs the provider's effects twice. The second run keeps the running program, so the layer builds once.
- Each page renders `DeskClient` with `key={seed.seedKey}`. A new key remounts the provider, so each page gets a new program with fresh server data. The remount disposes the old runtime, which interrupts its commands and its subscription. After you navigate to another desk, auto-refresh is off again. To keep work running across navigation, mount the program in a client component that the root layout renders.
- `update` is pure. A message that needs the time carries it: the click handler sends `SetTaskStatus({ id, status, at })`. The `DeskApi` service reads the time from Effect's `Clock`. Activity items take their ids from `nextActivityId` in the model, so two items never share a React key.
- `RefreshRequested` returns a command that calls `DeskApi.refresh`. The command turns a failure into `RefreshFailed`. While auto-refresh is on, a subscription sends `RefreshTick` on an interval.

## The view

`components/hooks.ts` makes the typed hooks with `createOakHooks<DeskModel, DeskMsg>()`.

`components/desk-view.tsx` splits the page into small components. Each one selects only what it renders, so a message re-renders only the components whose data changed.

- A selector that returns a value from the model, such as `(model) => model.filter`, needs no memoizing. The value keeps its reference until `update` replaces it.
- `selectVisibleTasks` and `selectSummary` build a new array or object on each call. They use reselect's `createSelector`, so they return the same reference until the tasks or the filter change.

Times render in UTC with a fixed locale. The server and the browser can be in different time zones, and the same text on both keeps hydration consistent.
