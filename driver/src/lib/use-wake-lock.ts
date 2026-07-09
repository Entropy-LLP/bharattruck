'use client'

import { useEffect, useRef } from 'react'

/**
 * Screen Wake Lock (FROZEN contract D-008). Keeps the driver's screen awake
 * while a trip is active so the OS doesn't sleep the screen and throttle
 * background GPS mid-trip — the core driver use case.
 *
 * - Acquires the lock while `active` is true and the page is visible.
 * - Re-acquires on `visibilitychange` (the browser auto-releases a wake lock
 *   whenever the page is hidden, e.g. the driver switches to Google Maps).
 * - Releases on trip end / unmount.
 * - Feature-detected: a no-op where the API is unavailable (older browsers) or
 *   the context is insecure (HTTP) — never throws.
 */
export function useScreenWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!active) return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let cancelled = false

    const acquire = async () => {
      if (cancelled || sentinelRef.current) return
      if (document.visibilityState !== 'visible') return
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) {
          sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null
        })
      } catch {
        // request() can reject (page hidden, low battery, policy) — best-effort.
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      sentinelRef.current?.release().catch(() => {})
      sentinelRef.current = null
    }
  }, [active])
}
