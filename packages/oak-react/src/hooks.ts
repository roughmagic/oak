// hooks.ts: useSelector and useDispatch, the read side and the write side of oak-react.
//
// useSelector reads the model, and useDispatch sends messages. Neither hook builds, starts or
// stops anything. The provider owns the program's life, and the hooks only read its handle.
//
// Place in oak-react: OakProvider (provider.ts) puts the handle in React context. Both hooks
// find it with useOak, which throws outside an OakProvider.

import { useMemo, useSyncExternalStore } from 'react'
import { useOak } from './provider.js'

/**
 * The two hooks that `createOakHooks` returns, typed for one app's model `M` and messages
 * `Msg`.
 */
export interface OakHooks<M, Msg> {
  /**
   * Returns `selector(model)` and re-renders when the result changes by `Object.is`. A
   * selector that builds an object returns a new reference whenever the model changes. Select
   * smaller values or memoize the selector when a component should skip those renders.
   *
   * React calls the selector during render and while `dispatch` notifies listeners, so keep it
   * pure.
   */
  readonly useSelector: <A>(selector: (model: M) => A) => A

  /**
   * Returns a `dispatch` that sends each message to the program running at that moment. It is
   * the same function on every render while the provider's `program` and `runtime` props stay
   * the same. With a `layer`, it stays the same for the provider's whole life, also when the
   * provider starts its program again.
   *
   * If `update` throws, `dispatch` rethrows. After the program stops, `dispatch` does nothing.
   */
  readonly useDispatch: () => (msg: Msg) => void
}

/**
 * Returns the hooks typed for the app's model and messages. Call it once at module scope. The
 * hooks read the `OakProvider` above them; a React app has one, as a Redux app has one store.
 *
 * TypeScript does not check `M` and `Msg` against the program under the provider. Pass the
 * model and message types of that program.
 */
export function createOakHooks<M, Msg>(): OakHooks<M, Msg> {
  // Every call returns the same two module-level functions. The factory exists for the types:
  // it fixes M and Msg once, so a component writes useSelector((m) => m.count) with m typed M.
  return { useSelector, useDispatch }
}

// useSelector reads the model through React's useSyncExternalStore, which takes three functions:
// - subscribe registers a listener for model changes;
// - getSnapshot returns the value to render now;
// - getServerSnapshot returns the value for the server render and for hydration.
function useSelector<M, A>(selector: (model: M) => A): A {
  const oak = useOak()

  // One cache per handle and selector. A stable selector keeps its cache across renders, and it
  // runs once per new model. An inline selector is a new function on every render: useMemo
  // builds a new cache, and the selector runs once more in that render.
  const { getSnapshot, getServerSnapshot } = useMemo(() => {
    // React needs the same snapshot until the store changes, so the result is cached per model.
    //
    // React calls getSnapshot in render, in the store listener and after commit. In development
    // it calls it twice in a row and logs an error if the results differ by Object.is. Without
    // the cache, a selector that builds an object gives a new result on every call, and React
    // renders again without end.
    //
    // The model reference is a sound key, because update never mutates a model (see Update in
    // Oak's types.ts). The same reference holds the same data, so a pure selector gives the same
    // result.
    let last: { readonly model: M; readonly value: A } | undefined

    const select = (model: M): A => {
      if (last === undefined || !Object.is(last.model, model)) {
        last = { model, value: selector(model) }
      }
      return last.value
    }

    return {
      // The hooks are typed by createOakHooks; the provider holds any program. The handle in
      // context is typed with unknown, and these two casts are where M enters.
      //
      // Before the program runs, state.value is the init model. After, it is the live model.
      getSnapshot: () => select(oak.state.value as M),

      // The server renders the init model, and hydration reads it again, so the client's first
      // render matches the server's HTML even when the program already runs. After hydration,
      // React calls getSnapshot and re-renders if the live model gives another value.
      getServerSnapshot: () => select(oak.initModel as M),
    }
  }, [oak, selector])

  // oak.state.subscribe is one function per handle. React subscribes again only when subscribe
  // changes, so a parent re-render or a new selector keeps the one listener on the program.
  //
  // The model can change after this render and before React subscribes. The provider starts the
  // program in a layout effect, and a child's layout effect can dispatch. React subscribes in a
  // passive effect, after every layout effect, so it subscribes to the running program. Then it
  // calls getSnapshot and re-renders if the value changed. No change is lost in that gap.
  //
  // React renders a store change in its sync lane, and it flushes that lane before it restores
  // a controlled input. Oak's kernel calls React's store listener inside dispatch, so React
  // schedules the re-render in that lane before the event ends. An input whose value comes from
  // the model then keeps its caret where the user typed.
  //
  // React also checks a concurrent render against the store before it commits, and it renders
  // again if the model changed in between.
  return useSyncExternalStore(oak.state.subscribe, getSnapshot, getServerSnapshot)
}

// useDispatch returns the handle's dispatch, not the program's. It forwards each message to the
// program that runs at that moment, and it stays the same function while the provider keeps its
// handle (see Handle in provider.ts). A component can list it in effect dependencies without
// re-running the effect.
//
// The handle's dispatch takes unknown, so it fits (msg: Msg) => void without a cast.
function useDispatch<Msg>(): (msg: Msg) => void {
  return useOak().dispatch
}
