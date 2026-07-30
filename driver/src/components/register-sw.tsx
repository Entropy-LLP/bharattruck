'use client'

import { useEffect } from 'react'

/**
 * Registers the app-shell service worker (public/sw.js). Feature-detected and
 * best-effort — a failed/absent SW must never break the app. Requires a secure
 * context (HTTPS or localhost); browsers silently no-op otherwise.
 *
 * Production only. The SW serves same-origin static assets cache-first, and
 * Turbopack reuses dev chunk URLs across edits, so in dev it pins the browser
 * to a pre-edit bundle: HMR stops landing and you get hydration mismatches that
 * survive a hard reload. In dev we therefore tear down any registration left
 * behind by a production build instead of adding one.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker
        .getRegistrations()
        .then(regs => Promise.all(regs.map(r => r.unregister())))
        .catch(() => {})
      if (typeof caches !== 'undefined') {
        caches
          .keys()
          .then(keys =>
            Promise.all(
              keys.filter(k => k.startsWith('bt-driver-shell')).map(k => caches.delete(k)),
            ),
          )
          .catch(() => {})
      }
      return
    }

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
