import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { getSupabaseClient } from '../lib/supabase'
import { authErrorMessage, signInWithGitHub as startGitHubSignIn, type OAuthClient } from './auth'

type AuthErrorLike = { message?: string; code?: string } | null

export interface AuthClient extends OAuthClient {
  getSession(): Promise<{ data: { session: Session | null }; error: AuthErrorLike }>
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe(): void } }
  }
  signOut(): Promise<{ error: AuthErrorLike }>
  exchangeCodeForSession(code: string): Promise<{ data: { session: Session | null }; error: AuthErrorLike }>
}

export interface AuthContextValue {
  loading: boolean
  pending: boolean
  session: Session | null
  user: User | null
  error: string | null
  signInWithGitHub(returnPath?: string): Promise<void>
  signOut(): Promise<void>
}

const defaultAuth: AuthContextValue = {
  loading: false,
  pending: false,
  session: null,
  user: null,
  error: null,
  signInWithGitHub: async () => undefined,
  signOut: async () => undefined,
}

export const AuthContext = createContext<AuthContextValue>(defaultAuth)

interface AuthProviderProps {
  children: ReactNode
  client?: AuthClient
  origin?: string
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

export function AuthProvider({ children, client, origin, storage }: AuthProviderProps) {
  const authClient = client ?? (getSupabaseClient().auth as unknown as AuthClient)
  const returnStorage = storage ?? window.sessionStorage
  const callbackOrigin = origin ?? window.location.origin
  const mounted = useRef(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let authEventSeen = false
    mounted.current = true
    const subscription = authClient.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      authEventSeen = true
      setSession(nextSession)
      setLoading(false)
      setError(null)
    }).data.subscription

    void authClient.getSession()
      .then((result) => {
        if (!active || authEventSeen) return
        if (result.error) {
          setError(authErrorMessage(result.error, 'initialize'))
          setSession(null)
        } else {
          setSession(result.data.session)
        }
        setLoading(false)
      })
      .catch((caught) => {
        if (!active || authEventSeen) return
        setSession(null)
        setError(authErrorMessage(caught, 'initialize'))
        setLoading(false)
      })

    return () => {
      active = false
      mounted.current = false
      subscription.unsubscribe()
    }
  }, [authClient])

  const login = useCallback(async (returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`) => {
    setPending(true)
    setError(null)
    try {
      await startGitHubSignIn(authClient, returnPath, callbackOrigin, returnStorage)
    } catch (caught) {
      if (mounted.current) setError(authErrorMessage(caught, 'sign-in'))
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [authClient, callbackOrigin, returnStorage])

  const logout = useCallback(async () => {
    setPending(true)
    setError(null)
    try {
      const result = await authClient.signOut()
      if (result.error) throw result.error
      if (mounted.current) setSession(null)
    } catch (caught) {
      if (mounted.current) setError(authErrorMessage(caught, 'sign-out'))
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [authClient])

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    pending,
    session,
    user: session?.user ?? null,
    error,
    signInWithGitHub: login,
    signOut: logout,
  }), [error, loading, login, logout, pending, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
