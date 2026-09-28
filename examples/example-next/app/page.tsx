import type { ReactElement } from 'react'
import { DeskClient } from '@/components/desk-client'
import { loadDeskSeed, type DeskSearchParams } from '@/lib/server-seed'

export default async function HomePage({
  searchParams,
}: {
  readonly searchParams: Promise<DeskSearchParams>
}): Promise<ReactElement> {
  const seed = await loadDeskSeed({
    desk: 'north',
    searchParams: await searchParams,
  })

  return <DeskClient key={seed.seedKey} seed={seed} />
}
