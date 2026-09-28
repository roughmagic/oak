import { Layer, ManagedRuntime } from 'effect'
import { DiceProgram, DiceRollerLive } from './oak-program/index.js'

export const appRuntime = ManagedRuntime.make(DiceProgram.layer.pipe(Layer.provide(DiceRollerLive)))
