import type { ReactElement } from 'react'
import { DeskClient } from '@/components/desk-client'
import { coerceDesk, loadDeskSeed, type DeskSearchParams, type RouteDesk } from '@/lib/server-seed'

export function generateStaticParams(): Array<{ readonly desk: RouteDesk }> {
  return [{ desk: 'north' }, { desk: 'west' }, { desk: 'launch' }]
}

export default async function DeskPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly desk: string }>
  readonly searchParams: Promise<DeskSearchParams>
}): Promise<ReactElement> {
  const { desk } = await params
  const seed = await loadDeskSeed({
    desk: coerceDesk(desk),
    searchParams: await searchParams,
  })

  return <DeskClient key={seed.seedKey} seed={seed} />
}
