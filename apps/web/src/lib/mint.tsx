import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { getPlatform, HAS_API } from '@/lib/api'
import { STABLE_MINT } from '@/mockData'

/**
 * Which settlement mint the amounts are in (`T066`).
 *
 * Every amount on screen is labelled with its mint. In the prototype that is
 * the fixture's address; live, it is the mint the platform on chain settles
 * in, read once from `GET /platform`. A live amount labelled with the
 * prototype's mint would name a token nobody is paid in.
 *
 * Until the platform answers, a live amount carries no mint label rather than
 * the wrong one.
 */
const MintContext = createContext<string | null>(STABLE_MINT.address)

export const MintProvider = ({ children }: { children: ReactNode }) => {
  const [mint, setMint] = useState<string | null>(HAS_API ? null : STABLE_MINT.address)

  useEffect(() => {
    if (!HAS_API) return
    const controller = new AbortController()
    getPlatform({ signal: controller.signal })
      .then((platform) => setMint(platform.mint))
      .catch(() => {
        // No platform, no label: the screens that need the platform say so
        // themselves, with the error.
      })
    return () => controller.abort()
  }, [])

  return <MintContext.Provider value={mint}>{children}</MintContext.Provider>
}

/** The settlement mint, or `null` while a live platform has not answered. */
export const useMint = (): string | null => useContext(MintContext)
