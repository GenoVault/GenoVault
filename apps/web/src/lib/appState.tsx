/**
 * Локальний стан прототипу: сесія, роль, тема, пул датасетів для прогону.
 * Ніякого Redux/Zustand — T066 змінює джерело даних, не архітектуру стану.
 *
 * Сесія має два втілення за одним інтерфейсом (`T016b`): `PrivySession` ходить
 * у справжній Privy, `MockSession` — вхід прототипу. Обирає між ними `HAS_PRIVY`,
 * тобто модульна константа, і вибір не змінюється між рендерами: два різні
 * набори хуків інакше міняли б порядок виклику.
 */

import { PrivyProvider, useLogin, useLogout, usePrivy } from '@privy-io/react-auth'
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { HAS_PRIVY, LOGIN_METHODS, PRIVY_APP_ID } from '@/lib/privy'
import { MOCK_SESSION, type Role } from '@/mockData'

export type SignInMethod = 'wallet' | 'email'

interface Session {
  /** Провайдер входу ще не відповів. У моці — завжди `true`. */
  ready: boolean
  signedIn: boolean
  method: SignInMethod | null
  address: string | null
  signIn: (method: SignInMethod) => void
  signOut: () => void
  /** `false`, коли вхід мокований: екран входу мусить це сказати вголос. */
  live: boolean
}

interface AppState extends Session {
  role: Role
  setRole: (role: Role) => void

  theme: 'light' | 'dark'
  toggleTheme: () => void

  /** Пул для /runs/new: ключі `owner/datasetId`. */
  pool: string[]
  addToPool: (key: string) => void
  removeFromPool: (key: string) => void
  clearPool: () => void
}

const AppStateContext = createContext<AppState | null>(null)
const SessionContext = createContext<Session | null>(null)

const useSession = (): Session => {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside a session provider')
  return ctx
}

// ── Справжній вхід ────────────────────────────────────────────────────────────

/**
 * Сесія з Privy.
 *
 * Адреса береться з **соланівських** гаманців, а не з `user.wallet`: останній
 * віддає перший прив'язаний гаманець будь-якої мережі, і на акаунті з EVM
 * гаманцем ми показали б власнику чужу адресу як його ончейн-ідентичність.
 */
const PrivySession = ({ children }: { children: ReactNode }) => {
  const { ready, authenticated } = usePrivy()
  const { login } = useLogin()
  const { logout } = useLogout()
  const { wallets } = useSolanaWallets()
  const [method, setMethod] = useState<SignInMethod | null>(null)

  const signIn = useCallback(
    (next: SignInMethod) => {
      setMethod(next)
      login({ loginMethods: [next] })
    },
    [login],
  )

  const signOut = useCallback(() => {
    setMethod(null)
    void logout()
  }, [logout])

  const value = useMemo<Session>(
    () => ({
      ready,
      signedIn: authenticated,
      method,
      address: wallets[0]?.address ?? null,
      signIn,
      signOut,
      live: true,
    }),
    [ready, authenticated, method, wallets, signIn, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// ── Вхід прототипу ────────────────────────────────────────────────────────────

/** Мок-сесія: жодної мережі, адреса з `mockData`. Живе, поки живе вкладка. */
const MockSession = ({ children }: { children: ReactNode }) => {
  const [method, setMethod] = useState<SignInMethod | null>(null)

  const signIn = useCallback((next: SignInMethod) => setMethod(next), [])
  const signOut = useCallback(() => setMethod(null), [])

  const value = useMemo<Session>(
    () => ({
      ready: true,
      signedIn: method !== null,
      method,
      address: method !== null ? MOCK_SESSION.address : null,
      signIn,
      signOut,
      live: false,
    }),
    [method, signIn, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// ── Спільна оболонка ──────────────────────────────────────────────────────────

const AppStateInner = ({ children }: { children: ReactNode }) => {
  const session = useSession()
  const [role, setRole] = useState<Role>('buyer')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [pool, setPool] = useState<string[]>([])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const addToPool = useCallback((key: string) => {
    setPool((prev) => (prev.includes(key) ? prev : [...prev, key]))
  }, [])

  const removeFromPool = useCallback((key: string) => {
    setPool((prev) => prev.filter((k) => k !== key))
  }, [])

  const clearPool = useCallback(() => setPool([]), [])

  const value = useMemo<AppState>(
    () => ({
      ...session,
      role,
      setRole,
      theme,
      toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
      pool,
      addToPool,
      removeFromPool,
      clearPool,
    }),
    [session, role, theme, pool, addToPool, removeFromPool, clearPool],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export const AppStateProvider = ({ children }: { children: ReactNode }) => {
  if (PRIVY_APP_ID === null) {
    return (
      <MockSession>
        <AppStateInner>{children}</AppStateInner>
      </MockSession>
    )
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: [...LOGIN_METHODS],
        // Гаманці — лише соланівські: іншої мережі в продукті немає, а
        // список із EVM-гаманцями пропонує користувачу те, чим він тут
        // нічого не зробить.
        appearance: { walletChainType: 'solana-only' },
        // Вхід поштою мусить закінчитися гаманцем, інакше «обидва шляхи далі
        // не відрізняються нічим» (`FR-023`) перестає бути правдою.
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' } },
      }}
    >
      <PrivySession>
        <AppStateInner>{children}</AppStateInner>
      </PrivySession>
    </PrivyProvider>
  )
}

export const useAppState = (): AppState => {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider')
  return ctx
}

export { HAS_PRIVY }
