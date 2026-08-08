'use client'

/**
 * Freight documents — the in-app document surface (Phase 4 of docs/UNIFIED_APP_PLAN.md;
 * migration 0024). Shows the paperwork a real trip generates and lets the carrier raise
 * the consignment note.
 *
 * - READ (GET /bookings/:id/documents): the LR, the shipper's tax invoice, and the
 *   recorded e-way bill(s) with their standing + expiry status. Relation-gated server-side.
 * - ISSUE LR (POST /bookings/:id/documents/lr): the carrier raises the consignment note,
 *   PREFILLED from the booking. The issuer identity is derived server-side (never sent);
 *   the write is idempotent per booking and allowed only while accepted / in_transit.
 *
 * Never blanks: loading / error / empty / content, and a clear message on every failure.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FileText } from 'lucide-react'

import { Card, CardHead, ErrorNote, Loading } from '@/components/stat'
import { ApiError, getBookingDocuments, issueFreightInvoice, issueLorryReceipt, recordEwayBill, setEwayBillStatus } from '@/lib/api'
import { inr, dateTime } from '@/lib/format'
import type { Booking, BookingDocuments, EwayBillRecord, FreightTerm, IssueInvoiceInput, IssueLorryReceiptInput } from '@/lib/types'

const FREIGHT_TERMS: { value: FreightTerm; label: string }[] = [
  { value: 'TO_PAY', label: 'To pay — receiver pays freight' },
  { value: 'PAID', label: 'Paid — consignor prepaid' },
  { value: 'TO_BE_BILLED', label: 'To be billed later' },
]

function freightTermLabel(t: FreightTerm): string {
  return FREIGHT_TERMS.find((x) => x.value === t)?.label ?? t
}

// datetime-local inputs give 'YYYY-MM-DDTHH:mm' in LOCAL time; the API wants RFC3339 with a
// zone. new Date(local) reads it as local and toISOString() emits the correct UTC 'Z' form.
function toIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function ewayBadges(ewb: EwayBillRecord): { statusCls: string; statusLabel: string; expiryCls: string; expiryLabel: string } {
  const statusMap: Record<EwayBillRecord['status'], { cls: string; label: string }> = {
    active: { cls: 'bg-emerald-100 text-emerald-800', label: 'Active' },
    cancelled: { cls: 'bg-gray-100 text-gray-600', label: 'Cancelled' },
    rejected: { cls: 'bg-red-100 text-red-800', label: 'Rejected' },
  }
  const exp = ewb.expiry
  const expiry =
    exp.state === 'valid' ? { cls: 'bg-emerald-100 text-emerald-800', label: `Valid · ${Math.round(exp.hours_remaining)}h left` }
      : exp.state === 'expiring_soon' ? { cls: 'bg-amber-100 text-amber-800', label: `Expiring · ${Math.round(exp.hours_remaining)}h left` }
        : { cls: 'bg-red-100 text-red-800', label: 'Expired' }
  const s = statusMap[ewb.status]
  return { statusCls: s.cls, statusLabel: s.label, expiryCls: expiry.cls, expiryLabel: expiry.label }
}

const inputCls =
  'w-full h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs text-gray-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function DocRow({ title, lines, icon }: { title: string; lines: string[]; icon?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
      {icon && <FileText className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />}
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        {lines.map((l) => <p key={l} className="text-xs text-gray-500 mt-0.5">{l}</p>)}
      </div>
    </div>
  )
}

export default function FreightDocuments({ booking, onChanged }: { booking: Booking; onChanged?: () => void }) {
  const [docs, setDocs] = useState<BookingDocuments | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  // LR form, prefilled from the booking — the carrier confirms rather than re-types.
  const [consigneeName, setConsigneeName] = useState(booking.consignee?.name ?? '')
  const [saidToContain, setSaidToContain] = useState(booking.load_type ?? '')
  const [weightKg, setWeightKg] = useState(String(booking.weight_kg ?? ''))
  const [freightCharge, setFreightCharge] = useState(String(booking.final_price ?? booking.quoted_price ?? ''))
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [freightTerm, setFreightTerm] = useState<FreightTerm>('TO_PAY')

  // Invoice form (shipper side), prefilled where the booking knows the answer.
  const [showInvoiceForm, setShowInvoiceForm] = useState(false)
  const [invoicing, setInvoicing] = useState(false)
  const [invoiceErr, setInvoiceErr] = useState<string | null>(null)
  const [billedTo, setBilledTo] = useState(booking.consignee?.name ?? '')
  const [taxableValue, setTaxableValue] = useState('')
  const [igst, setIgst] = useState('')

  // E-way bill: record (either party) + file the portal's cancel/reject.
  const [showEwayForm, setShowEwayForm] = useState(false)
  const [recordingEway, setRecordingEway] = useState(false)
  const [ewayErr, setEwayErr] = useState<string | null>(null)
  const [ewbNumber, setEwbNumber] = useState('')
  const [ewbGeneratedAt, setEwbGeneratedAt] = useState('')
  const [ewbValidUpto, setEwbValidUpto] = useState('')
  const [ewbPortal, setEwbPortal] = useState<'NIC1' | 'NIC2'>('NIC1')
  const [statusBusy, setStatusBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    getBookingDocuments(booking.id)
      .then((d) => setDocs(d))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not load documents.'))
      .finally(() => setLoading(false))
  }, [booking.id])

  useEffect(() => { load() }, [load])

  // Carrier (or assigned driver) may raise the LR; the server is the real gate, so stay
  // permissive when the relation block is absent. Only while accepted/in_transit, and only
  // if none exists yet (the write is idempotent, but there is no reason to offer a re-issue).
  const rel = booking.viewer?.relations
  const isCarrier = rel === undefined || rel.includes('carrier') || rel.includes('driver')
  const canIssueLr = isCarrier && ['accepted', 'in_transit'].includes(booking.status) && !!docs && !docs.lorry_receipt

  // The invoice is the SHIPPER's document; issuable pending → completed (wider than the LR
  // at both ends — the invoice number can precede a carrier and a TO_BE_BILLED load is
  // invoiced after delivery). Server-authorized; stay permissive when the relation is absent.
  const isShipper = rel === undefined || rel.includes('shipper')
  const canIssueInvoice =
    isShipper &&
    ['pending', 'negotiating', 'accepted', 'in_transit', 'completed'].includes(booking.status) &&
    !!docs && !docs.invoice

  // Either party records the externally-generated e-way bill (D-17). Offered when none
  // currently stands (a cancelled/rejected one leaves the slot open for its replacement).
  const canRecordEway = (isShipper || isCarrier) && !!docs && !docs.standing_eway_bill_number

  async function handleIssue(e: FormEvent) {
    e.preventDefault()
    const weight = Number(weightKg)
    const charge = Number(freightCharge)
    if (!consigneeName.trim()) { setFormErr('Enter the consignee name.'); return }
    if (!saidToContain.trim()) { setFormErr('Enter what the consignment contains.'); return }
    if (!Number.isFinite(weight) || weight <= 0) { setFormErr('Enter the actual weight in kg.'); return }
    if (!Number.isFinite(charge) || charge < 0) { setFormErr('Enter the freight charge.'); return }
    setIssuing(true)
    setFormErr(null)
    try {
      const body: IssueLorryReceiptInput = {
        consignor_name: booking.shipper_name,
        consignee_name: consigneeName.trim(),
        origin_place: booking.source_address,
        destination_place: booking.destination_address,
        actual_weight_kg: weight,
        said_to_contain: saidToContain.trim(),
        freight_charge_inr: charge,
        freight_term: freightTerm,
        ...(vehicleNumber.trim() ? { vehicle_number: vehicleNumber.trim() } : {}),
      }
      await issueLorryReceipt(booking.id, body)
      toast.success('Consignment note issued')
      setShowForm(false)
      load()
      onChanged?.()
    } catch (err) {
      setFormErr(err instanceof ApiError ? err.message : 'Could not issue the consignment note')
    } finally {
      setIssuing(false)
    }
  }

  async function handleIssueInvoice(e: FormEvent) {
    e.preventDefault()
    const taxable = Number(taxableValue)
    const igstNum = igst.trim() ? Number(igst) : undefined
    if (!billedTo.trim()) { setInvoiceErr('Enter who the invoice is billed to.'); return }
    if (!Number.isFinite(taxable) || taxable <= 0) { setInvoiceErr('Enter the taxable value of the goods.'); return }
    if (igstNum !== undefined && (!Number.isFinite(igstNum) || igstNum < 0)) { setInvoiceErr('Enter a valid IGST amount.'); return }
    setInvoicing(true)
    setInvoiceErr(null)
    try {
      const body: IssueInvoiceInput = {
        billed_to_name: billedTo.trim(),
        taxable_value_inr: taxable,
        ...(igstNum !== undefined ? { igst_inr: igstNum } : {}),
      }
      await issueFreightInvoice(booking.id, body)
      toast.success('Tax invoice issued')
      setShowInvoiceForm(false)
      load()
      onChanged?.()
    } catch (err) {
      setInvoiceErr(err instanceof ApiError ? err.message : 'Could not issue the invoice')
    } finally {
      setInvoicing(false)
    }
  }

  async function handleRecordEway(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{12}$/.test(ewbNumber.trim())) { setEwayErr('The e-way bill number is 12 digits.'); return }
    const genIso = toIso(ewbGeneratedAt)
    const validIso = toIso(ewbValidUpto)
    if (!genIso) { setEwayErr('Enter when the bill was generated.'); return }
    if (!validIso) { setEwayErr('Enter the valid-upto date and time.'); return }
    if (new Date(validIso).getTime() <= new Date(genIso).getTime()) { setEwayErr('Valid-upto must be after the generated time.'); return }
    setRecordingEway(true)
    setEwayErr(null)
    try {
      await recordEwayBill(booking.id, {
        ewb_number: ewbNumber.trim(),
        generated_at: genIso,
        valid_upto: validIso,
        issuing_portal: ewbPortal,
      })
      toast.success('E-way bill recorded')
      setShowEwayForm(false)
      setEwbNumber(''); setEwbGeneratedAt(''); setEwbValidUpto('')
      load()
      onChanged?.()
    } catch (err) {
      setEwayErr(err instanceof ApiError ? err.message : 'Could not record the e-way bill')
    } finally {
      setRecordingEway(false)
    }
  }

  async function handleSetEwayStatus(ewb: string, status: 'cancelled' | 'rejected') {
    setStatusBusy(ewb)
    try {
      await setEwayBillStatus(booking.id, ewb, { status })
      toast.success(`E-way bill marked ${status}`)
      load()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update the e-way bill')
    } finally {
      setStatusBusy(null)
    }
  }

  const isEmpty = docs && !docs.lorry_receipt && !docs.invoice && docs.eway_bills.length === 0

  return (
    <Card>
      <CardHead title="Freight documents" sub="Consignment note, invoice & e-way bill on file" />
      <div className="p-5 space-y-3">
        {loading && !docs && <Loading label="Loading documents" />}
        {error && !docs && <ErrorNote message={error} />}

        {docs && (
          <>
            {docs.lorry_receipt && (
              <DocRow
                icon
                title={`Consignment note ${docs.lorry_receipt.lr_number}`}
                lines={[
                  `To ${docs.lorry_receipt.consignee_name}`,
                  `${inr(docs.lorry_receipt.total_charge_inr)} · ${freightTermLabel(docs.lorry_receipt.freight_term)}`,
                  `Issued ${dateTime(docs.lorry_receipt.issued_at)}`,
                ]}
              />
            )}

            {docs.invoice && (
              <DocRow
                icon
                title={`Tax invoice ${docs.invoice.invoice_number}`}
                lines={[
                  `Billed to ${docs.invoice.billed_to_name}`,
                  `${inr(docs.invoice.grand_total_inr)} total`,
                  `Issued ${dateTime(docs.invoice.issued_at)}`,
                ]}
              />
            )}

            {docs.eway_bills.map((ewb) => {
              const b = ewayBadges(ewb)
              const standing = ewb.ewb_number === docs.standing_eway_bill_number
              return (
                <div key={ewb.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">E-way bill {ewb.ewb_number}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${b.statusCls}`}>{b.statusLabel}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${b.expiryCls}`}>{b.expiryLabel}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {ewb.issuing_portal} · generated {dateTime(ewb.generated_at)}{standing ? ' · currently standing' : ''}
                  </p>
                  {ewb.status === 'active' && (isShipper || isCarrier) && (
                    <div className="flex gap-3 mt-2">
                      <button
                        onClick={() => handleSetEwayStatus(ewb.ewb_number, 'cancelled')}
                        disabled={statusBusy === ewb.ewb_number}
                        className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
                      >
                        Mark cancelled
                      </button>
                      <button
                        onClick={() => handleSetEwayStatus(ewb.ewb_number, 'rejected')}
                        disabled={statusBusy === ewb.ewb_number}
                        className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
                      >
                        Mark rejected
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {isEmpty && (
              <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center">
                <p className="text-sm font-medium text-gray-700">No documents on file yet</p>
                <p className="text-xs text-gray-500 mt-1">
                  The carrier raises the consignment note; the shipper the tax invoice. They appear here once issued.
                </p>
              </div>
            )}

            {canIssueLr && (
              !showForm ? (
                <button
                  onClick={() => setShowForm(true)}
                  className="w-full h-11 rounded-xl border border-blue-600 text-blue-700 hover:bg-blue-50 font-semibold text-sm transition-colors"
                >
                  Issue consignment note (LR)
                </button>
              ) : (
                <form onSubmit={handleIssue} className="rounded-xl border border-gray-200 p-3 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Issue consignment note</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Prefilled from the booking — confirm the details. This raises a numbered LR that cannot be undone.
                    </p>
                  </div>
                  <Field label="Consignee">
                    <input value={consigneeName} onChange={(e) => { setConsigneeName(e.target.value); setFormErr(null) }} className={inputCls} />
                  </Field>
                  <Field label="Said to contain">
                    <input value={saidToContain} onChange={(e) => { setSaidToContain(e.target.value); setFormErr(null) }} className={inputCls} />
                  </Field>
                  <div className="flex gap-2">
                    <Field label="Actual weight (kg)" className="flex-1">
                      <input inputMode="decimal" value={weightKg} onChange={(e) => { setWeightKg(e.target.value.replace(/[^\d.]/g, '')); setFormErr(null) }} className={inputCls} />
                    </Field>
                    <Field label="Freight charge (₹)" className="flex-1">
                      <input inputMode="decimal" value={freightCharge} onChange={(e) => { setFreightCharge(e.target.value.replace(/[^\d.]/g, '')); setFormErr(null) }} className={inputCls} />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <Field label="Vehicle no. (optional)" className="flex-1">
                      <input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())} placeholder="MH12AB1234" className={inputCls} />
                    </Field>
                    <Field label="Freight term" className="flex-1">
                      <select value={freightTerm} onChange={(e) => setFreightTerm(e.target.value as FreightTerm)} className={inputCls}>
                        {FREIGHT_TERMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  {formErr && <p className="text-xs text-red-600">{formErr}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setShowForm(false); setFormErr(null) }} disabled={issuing} className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium text-sm disabled:opacity-50">Cancel</button>
                    <button type="submit" disabled={issuing} className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                      {issuing && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {issuing ? 'Issuing…' : 'Issue LR'}
                    </button>
                  </div>
                </form>
              )
            )}

            {canIssueInvoice && (
              !showInvoiceForm ? (
                <button
                  onClick={() => setShowInvoiceForm(true)}
                  className="w-full h-11 rounded-xl border border-blue-600 text-blue-700 hover:bg-blue-50 font-semibold text-sm transition-colors"
                >
                  Issue tax invoice
                </button>
              ) : (
                <form onSubmit={handleIssueInvoice} className="rounded-xl border border-gray-200 p-3 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Issue tax invoice</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Your invoice for the goods, billed to the consignee. Raises a numbered invoice that cannot be undone.
                    </p>
                  </div>
                  <Field label="Billed to">
                    <input value={billedTo} onChange={(e) => { setBilledTo(e.target.value); setInvoiceErr(null) }} className={inputCls} />
                  </Field>
                  <div className="flex gap-2">
                    <Field label="Taxable value (₹)" className="flex-1">
                      <input inputMode="decimal" value={taxableValue} onChange={(e) => { setTaxableValue(e.target.value.replace(/[^\d.]/g, '')); setInvoiceErr(null) }} className={inputCls} />
                    </Field>
                    <Field label="IGST (₹, optional)" className="flex-1">
                      <input inputMode="decimal" value={igst} onChange={(e) => { setIgst(e.target.value.replace(/[^\d.]/g, '')); setInvoiceErr(null) }} className={inputCls} />
                    </Field>
                  </div>
                  {invoiceErr && <p className="text-xs text-red-600">{invoiceErr}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setShowInvoiceForm(false); setInvoiceErr(null) }} disabled={invoicing} className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium text-sm disabled:opacity-50">Cancel</button>
                    <button type="submit" disabled={invoicing} className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                      {invoicing && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {invoicing ? 'Issuing…' : 'Issue invoice'}
                    </button>
                  </div>
                </form>
              )
            )}

            {canRecordEway && (
              !showEwayForm ? (
                <button onClick={() => setShowEwayForm(true)} className="text-sm font-medium text-gray-600 hover:text-gray-900">
                  Record an e-way bill
                </button>
              ) : (
                <form onSubmit={handleRecordEway} className="rounded-xl border border-gray-200 p-3 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Record e-way bill</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Enter the bill generated on the NIC portal. We record it — we don&apos;t generate one.
                    </p>
                  </div>
                  <Field label="E-way bill number (12 digits)">
                    <input inputMode="numeric" value={ewbNumber} onChange={(e) => { setEwbNumber(e.target.value.replace(/\D/g, '').slice(0, 12)); setEwayErr(null) }} placeholder="123456789012" className={inputCls} />
                  </Field>
                  <div className="flex gap-2">
                    <Field label="Generated at" className="flex-1">
                      <input type="datetime-local" value={ewbGeneratedAt} onChange={(e) => { setEwbGeneratedAt(e.target.value); setEwayErr(null) }} className={inputCls} />
                    </Field>
                    <Field label="Valid upto" className="flex-1">
                      <input type="datetime-local" value={ewbValidUpto} onChange={(e) => { setEwbValidUpto(e.target.value); setEwayErr(null) }} className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Portal">
                    <select value={ewbPortal} onChange={(e) => setEwbPortal(e.target.value as 'NIC1' | 'NIC2')} className={inputCls}>
                      <option value="NIC1">NIC1</option>
                      <option value="NIC2">NIC2</option>
                    </select>
                  </Field>
                  {ewayErr && <p className="text-xs text-red-600">{ewayErr}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setShowEwayForm(false); setEwayErr(null) }} disabled={recordingEway} className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium text-sm disabled:opacity-50">Cancel</button>
                    <button type="submit" disabled={recordingEway} className="flex-1 h-11 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                      {recordingEway && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {recordingEway ? 'Recording…' : 'Record'}
                    </button>
                  </div>
                </form>
              )
            )}
          </>
        )}
      </div>
    </Card>
  )
}
