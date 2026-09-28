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
