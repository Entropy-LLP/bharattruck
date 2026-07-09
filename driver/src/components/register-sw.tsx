'use client'

import { useEffect } from 'react'

/**
 * Registers the app-shell service worker (public/sw.js). Feature-detected and
 * best-effort — a failed/absent SW must never break the app. Requires a secure
 * context (HTTPS or localhost); browsers silently no-op otherwise.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // ignore — offline shell is a progressive enhancement
      })
    }
    if (document.readyState === 'complete') register()
    else {
      window.addEventListener('load', register, { once: true })
      return () => window.removeEventListener('load', register)
    }
  }, [])
  return null
}
