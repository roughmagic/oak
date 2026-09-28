import Link from 'next/link'
import type { ReactElement, ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'Oak Next.js example',
  description: 'Server-seeded Oak state with Next.js App Router navigation.',
}

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="topbar-inner">
              <div className="brand">
                <strong>Oak Ops Desk</strong>
                <span>Next.js App Router</span>
              </div>
              <nav className="nav" aria-label="Primary">
                <Link href="/">North</Link>
                <Link href="/desks/west?mode=planning">West planning</Link>
                <Link href="/desks/launch?mode=incident">Launch incident</Link>
              </nav>
            </div>
          </header>
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  )
}
