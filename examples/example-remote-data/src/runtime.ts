import { Layer, ManagedRuntime } from 'effect'
import { ItemApiLive, ItemProgram } from './oak-program/index.js'

export const appRuntime = ManagedRuntime.make(ItemProgram.layer.pipe(Layer.provide(ItemApiLive)))
