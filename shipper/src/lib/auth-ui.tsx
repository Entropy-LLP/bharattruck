/**
 * Shared chrome for the unauthenticated auth screens (login, forgot password,
 * reset password).
 *
 * These constants used to live inside `app/login/page.tsx`. They are lifted here
 * so the password-reset pages are guaranteed to match the login card instead of
 * drifting from a copy — an auth flow that changes shape between steps reads as
 * a phishing page, which is the last impression a login should give.
 *
 * Per the repo's copy-not-share rule for the two PWAs, `driver/` keeps its own
 * copy of this file; only the logo mark and the portal label differ.
 */

import Link from 'next/link'

// Shared control styles. `blue-*` is the app's accent token — remapped to the
// BharatTruck orange in globals.css, so it reads orange here.
export const LABEL = 'block text-sm font-medium text-foreground/75 mb-2'
export const FIELD =
  'w-full h-12 rounded-xl border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/25'
export const FIELD_OTP = `${FIELD} text-center text-lg font-mono tracking-[0.4em]`
export const BTN_PRIMARY =
  'w-full h-12 rounded-xl bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-35'
export const BTN_QUIET = 'w-full text-sm text-muted-foreground transition hover:text-foreground'
export const BTN_LINK = 'w-full text-sm font-medium text-blue-600 transition hover:text-blue-500'
export const HINT = 'text-sm leading-relaxed text-muted-foreground'

/** The cube mark used on every auth screen. */
export function AuthMark() {
  return (
    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/25">
      <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    </div>
  )
}

/**
 * Page shell for a standalone auth step — same wash, mark and card as /login.
 * `title` sits under the wordmark where the portal label sits on login.
 */
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* One soft accent wash behind the card — enough depth, no light show. */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[560px] -translate-x-1/2 rounded-full bg-blue-600/12 blur-[120px]" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <AuthMark />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">BharatTruck</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{title}</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-black/40">
          {children}
        </div>

        <Link
          href="/login"
          className="mt-6 block text-center text-sm text-muted-foreground transition hover:text-foreground"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
