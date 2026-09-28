// provider.ts: OakProvider, where a running Oak program meets React.
//
// Oak serves a running program as an Effect service: `state` to read the model, `dispatch` to
// send a message. React adds two rules of its own:
//
// - Render starts nothing. React may render on the server, render twice under StrictMode, or
//   throw a render away before it commits. A program started in render would leak.
// - The first render shows a real model, never a loading state, as a Redux store does.
//
// A handle meets both rules. It serves `program.init.model` until the program runs, and the live
// model after. When the provider starts the program, it starts it in the commit phase, from a
// layout effect in `Start`, before any layout or passive effect below the provider can dispatch.
//
// Two props say who owns the Effect runtime, and one component serves each:
//   runtime  ->  Host   The app owns the runtime. The provider never stops the program.
//   layer    ->  Owned  The provider owns one runtime per mount and disposes it on cleanup.
//
// Place in oak-react: OakProvider puts the handle in React context, and the hooks in hooks.ts
// read it.

import { Context, ManagedRuntime, type Layer, type Runtime } from 'effect'
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { OakState, Program, ProgramService } from '@roughmagic/oak'

// ---- Props --------------------------------------------------------------------------------------

// createElement fills P with this constraint, and only `any` lets every program through there.
// `Context.Tag` is invariant in its identifier and its service, so `Program` is invariant in its
// key, model and messages. No narrower type accepts every program.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProgram = Program<any, any, any, any>

/** The service identifier of program `P`, such as `ProgramId<'@my-app/Counter'>`. */
type Id<P extends AnyProgram> = Context.Tag.Identifier<P>

// The identifier of any program. Host and Owned take runtimes and layers typed by it, because
// OakProvider has already checked them against the program.
type AnyId = Id<AnyProgram>

/**
 * The props of `OakProvider`: `program`, and exactly one of `runtime` and `layer`.
 *
 * JSX infers `P` from `program`, then checks that `runtime` or `layer` provides it. A runtime or
 * layer that provides more services than the program also fits.
 */
export type OakProviderProps<P extends AnyProgram> = {
  /** The value `makeProgram` returned. */
  readonly program: P
  readonly children?: ReactNode
} & (
  | {
      /**
       * A runtime that the app owns and that provides `program`. A `ManagedRuntime` builds the
       * program on its first use. When the provider makes that use, it happens in the provider's
       * commit phase. A `Runtime` already runs it. The provider never stops the program.
       */
      readonly runtime: ManagedRuntime.ManagedRuntime<Id<P>, unknown> | Runtime.Runtime<Id<P>>

      // Each branch types the other prop as `never`, so passing both is a type error.
      readonly layer?: never
    }
  | {
      /**
       * A layer that provides `program`. The provider makes a runtime from it when it mounts and
       * disposes the runtime when it unmounts or an `<Activity>` hides it. The provider reads
       * `program` and `layer` on its first render only.
       */
      readonly layer: Layer.Layer<Id<P>, unknown>
      readonly runtime?: never
    }
)

// ---- The handle: what the hooks read ------------------------------------------------------------

// The provider holds any program, so it sees the service with unknown model and messages.
// createOakHooks gives the hooks the app's types.
type Service = ProgramService<unknown, unknown>

/**
 * What the hooks read. It stands in for the program's service, and it serves `initModel` until
 * the program runs.
 *
 * A handle keeps one `state` and one `dispatch` for its whole life, also when a provider-owned
 * program stops and starts again. So `useDispatch` returns one function, and
 * `useSyncExternalStore` gets the same `subscribe` on every render.
 *
 * For hooks.ts. The package index does not export it.
 */
export interface Handle {
  /** `program.init.model`. The server render and hydration read it. */
  readonly initModel: unknown

  /**
   * The live model once the program runs. `initModel` before it starts and after the provider
   * stops it.
   */
  readonly state: OakState<unknown>

  /** Sends a message to the running program. With no program running, it does nothing. */
  readonly dispatch: (this: void, msg: unknown) => void

  /**
   * Starts the program unless it runs, and cancels a pending `stop`. React calls it from a layout
   * effect. If the program cannot start, it throws.
   */
  readonly start: () => void

  /**
   * Stops the program one microtask later if the provider owns it, unless `start` runs first.
   * React calls it from a passive-effect cleanup.
   */
  readonly stop: () => void
}

// A program that runs.
interface Running {
  readonly service: Service
  /** Present only when the provider owns the runtime. It disposes that runtime. */
  readonly stop?: () => void
}

// The unsubscribe for a subscribe made while no program runs.
const noop = () => {}

// Makes the handle for one program.
//
// - `initModel` is what the handle serves while no program runs.
// - `start` starts the program. The handle calls it only while no program runs.
// - `running` is a service that already runs, read from a `Runtime`. A handle made with it never
//   calls `start`.
//
// `state`, `dispatch` and `stop` read `current` each time they run. So a program that starts
// after the first render, or starts again, reaches the hooks through the same handle.
function makeHandle(initModel: unknown, start: () => Running, running?: Service): Handle {
  // The running program. Undefined before the first start and after an owned program stops.
  let current: Running | undefined = running === undefined ? undefined : { service: running }

  // Under StrictMode, React's development build replays effects: when a component mounts, and
  // when an Offscreen, such as a Suspense boundary or an <Activity>, shows its content again. A
  // replay calls stop and then start in one synchronous call. A start before the next microtask
  // cancels the stop, so a replay keeps the program and its model.
  let stopping = false

  return {
    initModel,

    state: {
      get value() {
        return current === undefined ? initModel : current.service.state.value
      },

      // React subscribes in passive effects, which run after Start's layout effect has started
      // the program. With no program running there is nothing to hear, and noop stands in for
      // the unsubscribe.
      subscribe: (listener) =>
        current === undefined ? noop : current.service.state.subscribe(listener),
    },

    // With no program running, dispatch does nothing, as on a closed program.
    dispatch: (msg) => {
      current?.service.dispatch(msg)
    },

    start: () => {
      // Clearing the flag cancels a stop that waits for its microtask.
      stopping = false

      // `??=` starts a program only when none runs. If start throws, current stays undefined,
      // and the error leaves through the layout effect to the nearest error boundary.
      current ??= start()
    },

    stop: () => {
      // Only a provider-owned program stops. A handle over an app-owned runtime has no stop, and
      // neither has a handle with no program running.
      if (current?.stop === undefined) {
        return
      }

      // A replay calls start in the same synchronous call as this stop, so start clears the flag
      // before the microtask runs. A microtask is the shortest wait that outlasts a replay.
      stopping = true
      queueMicrotask(() => {
        // Each stop queues its own microtask. The first one to find the flag set stops the
        // program and clears the flag, so the others do nothing.
        const stop = current?.stop
        if (stopping && stop !== undefined) {
          stopping = false

          // Cleared before the runtime is disposed, so nothing reads a disposed runtime.
          current = undefined
          stop()
        }
      })
    },
  }
}

// ---- Context and the commit-phase start ---------------------------------------------------------

// null means that no OakProvider is above. useOak turns it into an error that names the missing
// provider.
const OakContext = createContext<Handle | null>(null)

// The provider's first child. React runs layout effects children first and siblings in order, so
// the program starts before any layout effect below the provider.
//
// A parent's layout effects run after its children's. So Host and Owned cannot start the program
// from their own effects: a child's layout effect would dispatch before the program runs.
//
// It stops in a passive cleanup. A Suspense boundary that shows its fallback again cleans up
// layout effects only, and a fallback must not restart the program. An unmount and a hiding
// <Activity> clean up both kinds.
function Start({ handle }: { readonly handle: Handle }): null {
  // start returns nothing, so this layout effect has no cleanup.
  useLayoutEffect(handle.start, [handle])

  // This passive effect does nothing on setup. It exists for its cleanup, which is stop.
  useEffect(() => handle.stop, [handle])

  return null
}

// Puts the handle in context, with Start before the children. This file is plain TypeScript, so
// it calls createElement. React 19 renders a context object as its provider.
const serve = (handle: Handle, children: ReactNode): ReactElement =>
  createElement(OakContext, { value: handle }, createElement(Start, { handle }), children)

// ---- `runtime`: the app owns the runtime --------------------------------------------------------

// One handle per (runtime, program), so a remount reads the live model.
//
// Without this cache, a remount over a ManagedRuntime would make a handle with no program in it.
// Its first render would show initModel, and the view would catch up only after the commit.
//
// The keys are weak, so a runtime or program that the app drops takes its handles with it.
const hostHandles = new WeakMap<object, WeakMap<object, Handle>>()

function Host({
  runtime,
  program,
  children,
}: {
  readonly runtime: ManagedRuntime.ManagedRuntime<AnyId, unknown> | Runtime.Runtime<AnyId>
  readonly program: AnyProgram
  readonly children?: ReactNode
}): ReactElement {
  // Render writes to the module cache here. The write is idempotent, and a new handle starts
  // nothing, so a render that React repeats or throws away does no harm.
  let byProgram = hostHandles.get(runtime)
  if (byProgram === undefined) {
    byProgram = new WeakMap()
    hostHandles.set(runtime, byProgram)
  }

  let handle = byProgram.get(program)
  if (handle === undefined) {
    handle = makeHandle(
      program.init.model,
      // Only a ManagedRuntime reaches this: a handle made with a running service never starts.
      // A ManagedRuntime builds its layer on first use, and building the layer runs the program.
      () => ({
        service: (runtime as ManagedRuntime.ManagedRuntime<AnyId, unknown>).runSync(program),
      }),
      // A Runtime already holds the running program, and reading it starts nothing.
      ManagedRuntime.isManagedRuntime(runtime)
        ? undefined
        : // Effect has no Runtime.isRuntime, and isManagedRuntime does not narrow the union.
          Context.unsafeGet((runtime as Runtime.Runtime<AnyId>).context, program),
    )
    byProgram.set(program, handle)
  }

  return serve(handle, children)
}

// ---- `layer`: the provider owns the runtime -----------------------------------------------------

function Owned({
  layer,
  program,
  children,
}: {
  readonly layer: Layer.Layer<AnyId, unknown>
  readonly program: AnyProgram
  readonly children?: ReactNode
}): ReactElement {
  // Read on the first render, like useState's initial value. The handle drops the runtime before
  // it disposes it, so no render or commit sees a disposed one.
  //
  // StrictMode calls this initializer twice and keeps one result. A handle starts nothing, so
  // the discarded one costs nothing.
  const [handle] = useState(() =>
    makeHandle(program.init.model, () => {
      // Each start makes a new runtime, so a program that starts again begins from init.
      // ManagedRuntime.make does not build the layer. runSync builds it, and so runs the program.
      //
      // Disposing closes the runtime's scope: the program stops dispatch, then Effect interrupts
      // its commands and subscriptions. Nothing awaits the promise. stop runs from a queued
      // microtask, and a failed start rethrows at once.
      const runtime = ManagedRuntime.make(layer)
      try {
        return { service: runtime.runSync(program), stop: () => void runtime.dispose() }
      } catch (error) {
        // runSync throws when the layer fails. Disposing releases what the build acquired.
        void runtime.dispose()
        throw error
      }
    }),
  )

  return serve(handle, children)
}

// ---- The public component -----------------------------------------------------------------------

/**
 * Serves `program` to the hooks below it. A React app has one `OakProvider`, near the root, as a
 * Redux app has one store.
 *
 * Render starts nothing: it reads `program.init.model`, or the live model once the program runs.
 * The server always renders `init.model`, so hydration matches. When the provider starts the
 * program, it starts it in the commit phase, before any layout or passive effect below the
 * provider. After it stops, `dispatch` does nothing.
 */
export function OakProvider<P extends AnyProgram>(props: OakProviderProps<P>): ReactElement
// Callers see only the signature above, where JSX checks `runtime` or `layer` against Id<P>.
// Id<P> is opaque inside a generic body, so the implementation takes any program.
export function OakProvider(props: OakProviderProps<AnyProgram>): ReactElement {
  const { program, children } = props

  // Two component types, so switching between `runtime` and `layer` remounts. React replaces a
  // subtree whose element type changes, and the unmount stops a provider-owned program.
  return props.layer === undefined
    ? createElement(Host, { runtime: props.runtime, program, children })
    : createElement(Owned, { layer: props.layer, program, children })
}

// ---- For the hooks ------------------------------------------------------------------------------

/**
 * Returns the handle of the nearest `OakProvider`, and throws outside one. For hooks.ts. The
 * package index does not export it.
 */
export function useOak(): Handle {
  const handle = useContext(OakContext)
  if (handle === null) {
    throw new Error('Oak: useSelector and useDispatch must be called inside an <OakProvider>.')
  }
  return handle
}
