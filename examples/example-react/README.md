# `@roughmagic/example-react`

A Vite and React app with three dice. Each roll runs through an Effect service.

- `src/oak-program/program.ts` makes the program with `makeProgram`. The model starts as `initialModel`, and `init` runs no commands.
- `src/runtime.ts` builds one `ManagedRuntime` at module scope. `Layer.provide` gives the program layer the `DiceRoller` service.
- `src/app.tsx` renders one `OakProvider` at the root, as a Redux app has one store. It passes the runtime with the `runtime` prop, so the app owns the runtime and the provider never stops the program.
- `src/hooks.ts` calls `createOakHooks<DiceModel, DiceMsg>()` once. Components use the typed `useSelector` and `useDispatch` it returns.
- The model types have `Data.case` constructors. `update` reads and writes the model through `@fp-ts/optic` lenses, and the selectors are built from the same lenses. Optic's `at` copies a value into a plain object, so `src/oak-program/optics.ts` composes `caseIso(X)` at each `Data.case` value on a lens's path. The model therefore stays a `Data.case` value after every update, and `Equal.equals` compares it by value.
- A roll is a command. It waits 650 ms, asks `DiceRoller` for a number, and yields `Rolled`. `DiceRoller.roll` cannot fail, so the command has no failure message.
- Auto-roll is a subscription. Its key holds the interval, the only model value its stream reads. The stream runs while auto-roll is on and restarts if the interval changes.

Run it from the repo root. Vite reads the Oak packages from their `dist` folders, and Turbo's `dev` task does not build them, so build once first:

```sh
pnpm build --filter=@roughmagic/example-react
pnpm dev --filter=@roughmagic/example-react
```
