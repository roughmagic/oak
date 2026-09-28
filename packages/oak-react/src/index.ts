// index.ts: the public entry of `@roughmagic/oak-react`, React bindings for Oak.
//
// oak-react is two small files. Read them in this order:
//
//   provider.ts  OakProvider: serves one program to a React tree, through a handle in context
//   hooks.ts     createOakHooks: returns useSelector and useDispatch, typed for the app
//
// One component and one hook factory leave the package. useOak and the Handle type stay
// internal, so components reach the provider only through the hooks.
//
// Loading this module calls React's createContext, in provider.ts. React's build for Server
// Components (the react-server condition) has no createContext. So a Server Component may import
// types from this package, but not values.

export { OakProvider, type OakProviderProps } from './provider.js'
export { createOakHooks, type OakHooks } from './hooks.js'
