/**
 * Локальний стан прототипу: мок-сесія, роль, тема, пул датасетів для прогону.
 * Ніякого Redux/Zustand — T066 змінює джерело даних, не архітектуру стану.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { MOCK_SESSION, type Role } from '@/mockData'

export type SignInMethod = 'wallet' | 'email'

interface AppState {
  signedIn: boolean
  method: SignInMethod | null
  address: string | null
  signIn: (method: SignInMethod) => void
  signOut: () => void

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

export const AppStateProvider = ({ children }: { children: ReactNode }) => {
  const [signedIn, setSignedIn] = useState(false)
  const [method, setMethod] = useState<SignInMethod | null>(null)
  const [role, setRole] = useState<Role>('buyer')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [pool, setPool] = useState<string[]>([])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const signIn = useCallback((next: SignInMethod) => {
    setMethod(next)
    setSignedIn(true)
  }, [])

  const signOut = useCallback(() => {
    setMethod(null)
    setSignedIn(false)
  }, [])

  const addToPool = useCallback((key: string) => {
    setPool((prev) => (prev.includes(key) ? prev : [...prev, key]))
  }, [])

  const removeFromPool = useCallback((key: string) => {
    setPool((prev) => prev.filter((k) => k !== key))
  }, [])

  const clearPool = useCallback(() => setPool([]), [])

  const value = useMemo<AppState>(
    () => ({
      signedIn,
      method,
      address: signedIn ? MOCK_SESSION.address : null,
      signIn,
      signOut,
      role,
      setRole,
      theme,
      toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
      pool,
      addToPool,
      removeFromPool,
      clearPool,
    }),
    [signedIn, method, signIn, signOut, role, theme, pool, addToPool, removeFromPool, clearPool],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export const useAppState = (): AppState => {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider')
  return ctx
}
