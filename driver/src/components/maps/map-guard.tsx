'use client'

/**
 * MapGuard — keeps a Google Maps failure from taking down the page around it.
 *
 * WHY THIS EXISTS: the Maps JS API can fail for reasons that have nothing to do with our
 * code and everything to do with billing, quota, or key restriction — `RefererNotAllowedMapError`
 * (the origin is not on the key's allowlist), `ApiNotActivatedMapError`, `OverQuotaMapError`,
 * an expired key. Verified on 2026-07-31 in the fleet console: with the production browser key
 * (allowlisted to `https://*.run.app/*`) the page rendered "This page couldn't load" on
 * localhost — a Maps rejection had crashed the entire React tree.
 *
 * It matters MORE here than anywhere else. A shipper losing their map is an inconvenience;
 * a DRIVER losing the page loses the Mark-as-Delivered button and the POD flow, mid-trip, on
 * a cheap Android in a rural dead zone. The trip controls must never depend on Google.
 *
 * That trade is backwards. The map is an aid; the TRIP CONTROLS are the product, and they
 * need no Google at all. A quota blip at 3 a.m. must cost the driver their map, never their
 * ability to complete and get paid for the delivery.
 *
 * Two independent failure paths, because they surface differently:
 *   1. `window.gm_authFailure` — Google's own callback for auth/restriction rejections. It
 *      does NOT throw, so no error boundary would ever see it; the map just silently stays
 *      blank or grey.
 *   2. A thrown render error inside the map subtree — caught by the boundary below.
 *
 * Copied from fleet/src/components/map-guard.tsx per D-013. This closes the driver half of
 * BIBLE §5.4 item 10 ("degrades gracefully on a
 * *missing* key but not an *invalid* one"). The shipper's LiveTrackMap still has it open.
 */

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

// ── 1. Google's auth-failure callback ─────────────────────────

let authFailed = false
const listeners = new Set<() => void>()

function markFailed() {
  if (authFailed) return
  authFailed = true
  listeners.forEach((l) => l())
}

let probesInstalled = false

/**
 * Install both detectors exactly once per page, and never uninstall them.
 *
 * THE BUG THIS SHAPE AVOIDS: doing the console patch inside the hook's effect looks natural
 * but is broken under React StrictMode, which mounts every effect twice. Mount 2 captures
 * mount 1's ALREADY-PATCHED console.error as its "original", then mount 1's cleanup restores
 * the pristine function — silently removing mount 2's probe. Verified on 2026-07-31: Google
 * logged `RefererNotAllowedMapError` and the fallback never appeared, because by then the
 * probe had been cleaned away.
 *
 * Both detectors are passive observers with no per-component state, so installing once and
 * leaving them is both correct and simpler than trying to make teardown reentrant.
 */
function installProbes() {
  if (probesInstalled || typeof window === 'undefined') return
  probesInstalled = true

  // Google's own callback. It does NOT throw, so no error boundary can see this path.
  ;(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = markFailed

  // Belt and braces: Google reports restriction errors (RefererNotAllowed, ApiNotActivated,
  // OverQuota) to the console before — and sometimes instead of — calling gm_authFailure.
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    if (args.some((a) => typeof a === 'string' && a.includes('Google Maps JavaScript API error'))) {
      markFailed()
    }
    originalError(...args)
  }
}

// Installed at MODULE scope, not inside the hook's effect, and this ordering is load-bearing.
// APIProvider begins fetching the Maps script during render, so a rejection can be logged
// before any effect has run — observed on 2026-07-31, where the fallback stayed hidden on a
// warm load even though Google had clearly logged RefererNotAllowedMapError. Importing this
// module is guaranteed to happen before the map renders, so the probes are always in place
// first. Guarded for SSR, where there is no window to patch.
installProbes()

/** True once the Maps JS API has rejected our key. */
export function useMapsAuthFailed(): boolean {
  const [failed, setFailed] = useState(authFailed)

  useEffect(() => {
    installProbes()
    // A failure can land between the initial render and this effect, so re-read rather
    // than trusting the state captured at mount.
    if (authFailed) setFailed(true)

    const listener = () => setFailed(true)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  return failed
}

// ── 3. Render watchdog ────────────────────────────────────────

/**
 * The detector of last resort: did the map actually DRAW anything?
 *
 * Neither signal above is dependable on its own. `gm_authFailure` is not invoked on every
 * rejection path, and the console probe can be bypassed entirely — verified on 2026-07-31,
 * where Google logged `RefererNotAllowedMapError` on every load yet the wrapper never saw it,
 * because Next's dev tooling had captured a pristine `console.error` before this module was
 * even imported and calls that reference instead.
 *
 * So rather than trying to catch every way a failure can be *announced*, this watches the
 * only thing that actually matters: whether tiles appeared. Any cause — bad key, dead
 * network, blocked domain, exhausted quota, an SDK change that renames the error — ends in
 * the same observable state, and the owner gets the same honest fallback.
 *
 * `onReady` must be called when the map genuinely paints (the `tilesloaded` event).
 */
export function useMapRenderWatchdog(timeoutMs = 8000): { timedOut: boolean; onReady: () => void } {
  const [timedOut, setTimedOut] = useState(false)
  const ready = useRef(false)

  useEffect(() => {
    if (ready.current) return
    const id = setTimeout(() => {
      if (!ready.current) setTimedOut(true)
    }, timeoutMs)
    return () => clearTimeout(id)
  }, [timeoutMs])

  const onReady = useCallback(() => {
    ready.current = true
    setTimedOut(false)
  }, [])

  return { timedOut, onReady }
}

// ── 2. Render-error boundary ──────────────────────────────────

/**
 * Catches anything thrown inside the map subtree and renders `fallback` instead.
 *
 * A class component because React still offers no hook equivalent of
 * `componentDidCatch` — this is one of the few places a class is the only option.
 */
export class MapBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error: Error) {
    // Logged, not swallowed: the owner keeps a working dashboard, and we still want the
    // real reason in the console for whoever debugs it.
    console.warn('[driver] Live map failed to render; trip controls unaffected.', error)
  }

  render() {
    return this.state.crashed ? this.props.fallback : this.props.children
  }
}
