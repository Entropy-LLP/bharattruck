'use client'

/**
 * Persona-completeness rings (D-33). For each persona the user HAS, a ring showing how much
 * of that persona's profile is filled and the items still open. It NEVER gates anything
 * (D-31): every unmet item is a prompt with an "I'll provide later" escape hatch — a signed
 * acknowledgement, which is a stronger legal position than a blank. The server's
 * `gates_nothing: true` is honoured; nothing here blocks a surface or an action.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Card, CardHead, ErrorNote, Loading } from '@/components/stat'
import { useAuth } from '@/lib/auth'
import { ApiError, acknowledgePersona, getMyCompleteness } from '@/lib/api'
import type { CompletenessItem, CompletenessReport, PersonaCompleteness } from '@/lib/types'

const PERSONA_LABEL: Record<PersonaCompleteness['persona'], string> = {
  shipper: 'Shipper', driver: 'Driver', fleet_owner: 'Fleet owner',
}

const STATUS_STYLE: Record<CompletenessItem['status'], { label: string; cls: string }> = {
  verified: { label: 'Verified', cls: 'bg-emerald-100 text-emerald-800' },
  declared: { label: 'Declared', cls: 'bg-blue-100 text-blue-800' },
  missing: { label: 'Needed', cls: 'bg-gray-100 text-gray-500' },
}

function Ring({ pct }: { pct: number }) {
  const r = 18
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  const dash = (clamped / 100) * c
  const tone = clamped >= 100 ? 'text-emerald-500' : clamped >= 50 ? 'text-blue-500' : 'text-amber-500'
  return (
    <div className="relative w-12 h-12 shrink-0">
      <svg viewBox="0 0 44 44" className="w-12 h-12 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-gray-100" />
        <circle
          cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`} className={tone}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-gray-700 tabular-nums">
        {clamped}%
      </span>
    </div>
  )
}

function AckButton({ kind, busy, onAck }: { kind: string; busy: boolean; onAck: (k: string) => void }) {
  return (
    <button
      onClick={() => onAck(kind)}
      disabled={busy}
      className="shrink-0 text-xs font-medium text-blue-700 hover:text-blue-800 disabled:opacity-50"
    >
      {busy ? 'Saving…' : "I'll provide later"}
    </button>
  )
}

export default function CompletenessSection() {
  const { personas } = useAuth()
  const [report, setReport] = useState<CompletenessReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ackBusy, setAckBusy] = useState<string | null>(null)

  // Lead with the user's PRIMARY persona (D-32 front door): their main role's ring
  // sits first and wears a badge; the rest follow in the server's order. primary_persona
  // can be 'admin' (matches no completeness persona) — the sort then no-ops and the
  // list stays as the server sent it. A stable sort keeps the non-primary order intact.
  const primary = personas?.primary_persona
  const ordered = useMemo(() => {
    const list = report?.personas ?? []
    return [...list].sort((a, b) => Number(b.persona === primary) - Number(a.persona === primary))
  }, [report, primary])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    getMyCompleteness()
      .then((r) => setReport(r.completeness))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not load your profile completeness.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function acknowledge(kind: string) {
    setAckBusy(kind)
    try {
      await acknowledgePersona(kind)
      toast.success('Noted — you can provide the document later')
      load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not record that')
    } finally {
      setAckBusy(null)
    }
  }

  return (
    <Card className="mb-5">
      <CardHead title="Profile completeness" sub="What each of your roles still needs" />
      <div className="p-4">
        {loading && !report && <Loading label="Loading completeness" />}
        {error && !report && <ErrorNote message={error} />}
        {report && report.personas.length === 0 && (
          <p className="text-sm text-gray-500">Nothing to complete yet.</p>
        )}
        {report && ordered.length > 0 && (
          <div className="space-y-5">
            {ordered.map((p) => (
              <div key={p.persona}>
                <div className="flex items-center gap-3 mb-2">
                  <Ring pct={p.percentage} />
                  <div>
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                      {PERSONA_LABEL[p.persona]}
                      {p.persona === primary && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Primary</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {p.items.filter((i) => i.status !== 'missing').length} of {p.items.length} done
                    </p>
                  </div>
                </div>
                <ul className="space-y-2">
                  {p.items.map((item) => {
                    const s = STATUS_STYLE[item.status]
                    const ackKind = item.acknowledgement_kind
                    return (
                      <li key={`${p.persona}-${item.key}`} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{item.label}</span>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
                        </div>
                        {item.status === 'missing' && ackKind && (
                          <AckButton kind={ackKind} busy={ackBusy === ackKind} onAck={acknowledge} />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
