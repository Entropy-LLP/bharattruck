'use client'

import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react'

/**
 * The stat tile. Deliberately plain: white card, 1px border, shadow-sm — the
 * dominant card convention in driver/ and shipper/ (depth comes from borders,
 * not shadows).
 */
export function Stat({
  label, value, sub, tone = 'neutral', icon, info,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'neutral' | 'good' | 'bad' | 'warn'
  icon?: ReactNode
  /** Optional one-phrase hover hint for a term that isn't self-explanatory (e.g. Variance).
   *  Renders a small ⓘ next to the label — the only place explanatory text belongs. */
  info?: string
}) {
  const valueTone =
    tone === 'good' ? 'text-emerald-700'
    : tone === 'bad' ? 'text-red-600'
    : tone === 'warn' ? 'text-orange-600'
    : 'text-gray-900'

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-gray-400 uppercase tracking-wide inline-flex items-center gap-1">
          {label}
          {info && (
            <span title={info} aria-label={info} className="text-gray-300 cursor-help normal-case">
              <Info className="w-3 h-3" />
            </span>
          )}
        </span>
        {icon && <span className="text-gray-300 shrink-0">{icon}</span>}
      </div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${valueTone}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

/** Signed delta chip — green up, red down. */
export function Delta({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value === null || Number.isNaN(value)) return <span className="text-gray-400">—</span>
  const good = value >= 0
  const Icon = good ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${good ? 'text-emerald-600' : 'text-red-600'}`}>
      <Icon className="w-3.5 h-3.5" />
      {Math.abs(value).toFixed(1)}{suffix}
    </span>
  )
}

/**
 * Horizontal meter for the three utilisation views. Colour encodes health, not
 * category: under 50% is a problem worth seeing at a glance.
 */
export function Meter({ pct, label }: { pct: number | null; label?: string }) {
  if (pct === null || Number.isNaN(pct)) {
    return <div className="text-sm text-gray-400">Not enough data</div>
  }
  const clamped = Math.max(0, Math.min(100, pct))
  const bar =
    clamped >= 75 ? 'bg-emerald-500'
    : clamped >= 50 ? 'bg-blue-500'
    : clamped >= 30 ? 'bg-orange-400'
    : 'bg-red-500'

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        {label && <span className="text-xs text-gray-500">{label}</span>}
        <span className="text-sm font-semibold text-gray-900 tabular-nums">{clamped.toFixed(0)}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${bar} transition-[width] duration-500`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

/** "CLEARS EMI" / "SHORT" — the headline verdict for one asset. */
export function CoverPill({ covered }: { covered: boolean }) {
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
      covered ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
    }`}>
      {covered ? 'Clears EMI' : 'Short'}
    </span>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>{children}</div>
  )
}

export function CardHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-12 px-4">
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
      <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      {label}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {message}
    </div>
  )
}
