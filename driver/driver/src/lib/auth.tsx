'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  getToken,
  setToken as saveToken,
  clearToken,
  getRefreshToken,
  setRefreshToken as saveRefreshToken,
  clearRefreshToken,
  getMe,
  refreshAccessToken,
  type AuthUser,
} from './api'

type AuthContextType = {
  token: string | null
  user: AuthUser | null
  isReady: boolean
  login: (accessToken: string, refreshToken: string, user?: AuthUser) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  isReady: false,
  login: () => {},
  logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    async function init() {
      const stored = getToken()
      if (!stored) {
        setIsReady(true)
        return
      }

      setTokenState(stored)

      try {
        const data = await getMe()
        setUser(data.user)
      } catch {
        const rt = getRefreshToken()
        if (rt) {
          try {
            const { access_token } = await refreshAccessToken(rt)
            saveToken(access_token)
            setTokenState(access_token)
            const data = await getMe()
            setUser(data.user)
          } catch {
            clearToken()
            clearRefreshToken()
            setTokenState(null)
          }
        } else {
          clearToken()
          setTokenState(null)
        }
      }

      setIsReady(true)
    }

    init()
  }, [])

  function login(accessToken: string, refreshToken: string, userData?: AuthUser) {
    saveToken(accessToken)
    if (refreshToken) saveRefreshToken(refreshToken)
    setTokenState(accessToken)
    if (userData) setUser(userData)
  }

  function logout() {
    clearToken()
    clearRefreshToken()
    setTokenState(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, isReady, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
