/** Каркас: заголовок, навігація за роллю, мок-вхід, перемикач теми. */

import { LogOut, Moon, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAppState } from '@/lib/appState'
import { truncateMiddle } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Role } from '@/mockData'

const NAV: Record<Role, { to: string; label: string }[]> = {
  buyer: [
    { to: '/datasets', label: 'Catalog' },
    { to: '/runs/new', label: 'Order a run' },
  ],
  owner: [
    { to: '/datasets', label: 'Catalog' },
    { to: '/datasets/new', label: 'Register dataset' },
    { to: '/balance', label: 'Balance' },
  ],
}

const RoleSwitch = () => {
  const { role, setRole } = useAppState()
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-surface-sunken/70 p-0.5">
      {(['buyer', 'owner'] as Role[]).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => setRole(r)}
          className={cn(
            'rounded-sm px-2.5 py-1 text-[12px] capitalize transition-colors',
            r === role
              ? 'bg-card text-foreground shadow-card'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

const SignInControl = () => {
  const { ready, signedIn, signIn, signOut, address, method, live } = useAppState()

  // Privy відповідає не миттєво. Кнопка «Sign in», намальована до відповіді,
  // блимає й пропонує зайти тому, хто вже зайшов.
  if (!ready) {
    return <div className="h-8 w-20 animate-shimmer rounded bg-muted" aria-hidden="true" />
  }

  if (!signedIn) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm">Sign in</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal text-[12.5px] text-muted-foreground">
            Two equal paths. Email creates a wallet for you.
            {!live && (
              <span className="mt-1 block text-warning">
                Prototype sign-in — no Privy app is configured.
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signIn('wallet')}>
            Continue with a wallet
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => signIn('email')}>Continue with email</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right sm:block">
        <p className="num text-[12.5px] leading-4">{truncateMiddle(address ?? '', 4, 4)}</p>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {live ? 'signed in' : 'prototype sign-in'} · {method}
        </p>
      </div>
      <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  )
}

export const AppShell = ({ children }: { children: ReactNode }) => {
  const { role, theme, toggleTheme } = useAppState()
  const { pathname } = useLocation()
  const nav = NAV[role]

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-surface-sunken/70">
        <p className="mx-auto max-w-[1400px] px-4 py-1.5 text-[11.5px] leading-4 text-muted-foreground md:px-8">
          M0 prototype on mock data. No network, no backend, no signed transactions — it closes no
          acceptance criterion.
        </p>
      </div>

      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-[2px]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:px-8">
          <Link to="/datasets" className="shrink-0">
            <span className="font-display text-[19px] tracking-tight">GenoVault</span>
          </Link>

          <nav className="order-3 flex w-full items-center gap-1 overflow-x-auto md:order-none md:w-auto">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'shrink-0 rounded-sm px-2.5 py-1.5 text-[13.5px] transition-colors',
                    isActive ||
                      (item.to === '/datasets' &&
                        pathname.startsWith('/datasets/') &&
                        pathname !== '/datasets/new')
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
                end={item.to === '/datasets'}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <RoleSwitch />
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
            <SignInControl />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-8 md:px-8 md:py-10">{children}</main>
    </div>
  )
}
