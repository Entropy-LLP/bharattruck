'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  emailLogin,
  getMe,
  authLogout,
  getToken,
  setToken,
  setRefreshToken,
  clearSession,
  decodeJwt,
  isOpsRole,
  ApiError,
  type AuthUser,
} from './api'

interface AuthState {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Rehydrate from a stored token on mount — but only trust an ops/admin role.
  useEffect(() => {
    const token = getToken()
    const claims = token ? decodeJwt(token) : null
    if (!token || !claims || !isOpsRole(claims.role)) {
      clearSession()
      setLoading(false)
      return
    }
    getMe()
      .then(({ user }) => {
        if (isOpsRole(user.role)) setUser(user)
        else clearSession()
      })
      .catch(() => clearSession())
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await emailLogin(email, password)
    if (!isOpsRole(res.user.role)) {
      // Do not persist a non-ops session on the ops console.
      throw new ApiError('This account is not authorized for the Operations console', 'FORBIDDEN', 403)
    }
    setToken(res.access_token)
    setRefreshToken(res.refresh_token)
    setUser(res.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await authLogout()
    } catch {
      // best-effort; clear locally regardless
    }
    clearSession()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
