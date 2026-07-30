'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { getBankAccounts, linkBankAccount, deleteBankAccount } from '@/lib/api'
import type { BankAccount } from '@/lib/types'
import Spinner from '@/components/spinner'

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/

const FIELD =
  'w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25'
const FIELD_LABEL = 'text-sm font-medium text-foreground/75'

export default function BankAccountStep() {
  const router = useRouter()

  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [accountNumber, setAccountNumber] = useState('')
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [bankName, setBankName] = useState('')
  const [holderName, setHolderName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const data = await getBankAccounts()
        setAccounts(data.bank_accounts)
        if (data.bank_accounts.length === 0) setShowForm(true)
      } catch {
        setShowForm(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function resetForm() {
    setAccountNumber('')
    setConfirmAccountNumber('')
    setIfsc('')
    setBankName('')
    setHolderName('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!accountNumber.trim()) {
      toast.error('Account number is required')
      return
    }
    if (accountNumber !== confirmAccountNumber) {
      toast.error('Account numbers do not match')
      return
    }
    if (!IFSC_REGEX.test(ifsc.trim().toUpperCase())) {
      toast.error('Invalid IFSC code (e.g. SBIN0001234)')
      return
    }
    if (!holderName.trim()) {
      toast.error('Account holder name is required')
      return
    }

    setSubmitting(true)
    try {
      const { bank_account } = await linkBankAccount({
        account_number: accountNumber.trim(),
        ifsc: ifsc.trim().toUpperCase(),
        ...(bankName.trim() ? { bank_name: bankName.trim() } : {}),
        account_holder_name: holderName.trim(),
        is_primary: accounts.length === 0,
      })
      setAccounts(prev => [bank_account, ...prev])
      resetForm()
      setShowForm(false)
      toast.success('Bank account linked')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to link bank account'
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      await deleteBankAccount(id)
      setAccounts(prev => prev.filter(a => a.id !== id))
      toast.success('Bank account removed')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove account'
      toast.error(message)
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-[414px] flex flex-col gap-4">

        {/* Header */}
        <div className="text-center mb-2">
          <div className="w-12 h-12 rounded-full bg-primary/12 flex items-center justify-center mx-auto mb-2">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <p className="text-xs text-muted-foreground">Step 5 — Bank account for payouts</p>
        </div>

        {/* Existing accounts */}
        {accounts.length > 0 && (
          <div className="flex flex-col gap-3">
            {accounts.map(acc => (
              <div
                key={acc.id}
                className="bg-card rounded-2xl border border-border/60 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-sm">
                      ●●●● {acc.account_number_last4}
                    </span>
                    {acc.is_primary && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/12 text-primary">
                        Primary
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(acc.id)}
                    disabled={deleting === acc.id}
                    className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
                  >
                    {deleting === acc.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{acc.account_holder_name}</span>
                  <span>IFSC: {acc.ifsc}</span>
                  {acc.bank_name && <span>{acc.bank_name}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add button */}
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="w-full rounded-xl border-2 border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add another account
          </button>
        )}

        {/* Bank account form */}
        {showForm && (
          <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">
                {accounts.length === 0 ? 'Link Bank Account' : 'Add Account'}
              </h3>
              {accounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm() }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">

              {/* Account holder name */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="holder-name" className={FIELD_LABEL}>
                  Account Holder Name <span className="text-primary">*</span>
                </label>
                <input
                  id="holder-name"
                  type="text"
                  value={holderName}
                  onChange={e => setHolderName(e.target.value)}
                  placeholder="Name as on bank account"
                  required
                  className={FIELD}
                />
              </div>

              {/* Account number */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="account-number" className={FIELD_LABEL}>
                  Account Number <span className="text-primary">*</span>
                </label>
                <input
                  id="account-number"
                  type="text"
                  inputMode="numeric"
                  value={accountNumber}
                  onChange={e => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter account number"
                  required
                  autoComplete="off"
                  className={FIELD}
                />
              </div>

              {/* Confirm account number */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-account" className={FIELD_LABEL}>
                  Confirm Account Number <span className="text-primary">*</span>
                </label>
                <input
                  id="confirm-account"
                  type="text"
                  inputMode="numeric"
                  value={confirmAccountNumber}
                  onChange={e => setConfirmAccountNumber(e.target.value.replace(/\D/g, ''))}
                  placeholder="Re-enter account number"
                  required
                  autoComplete="off"
                  className={`w-full rounded-xl border bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25 ${
                    confirmAccountNumber && confirmAccountNumber !== accountNumber
                      ? 'border-red-500/60'
                      : 'border-border'
                  }`}
                />
                {confirmAccountNumber && confirmAccountNumber !== accountNumber && (
                  <p className="text-xs text-red-500">Account numbers do not match</p>
                )}
              </div>

              {/* IFSC + Bank name row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ifsc" className={FIELD_LABEL}>
                    IFSC Code <span className="text-primary">*</span>
                  </label>
                  <input
                    id="ifsc"
                    type="text"
                    value={ifsc}
                    onChange={e => setIfsc(e.target.value.toUpperCase())}
                    placeholder="e.g. SBIN0001234"
                    required
                    maxLength={11}
                    autoCapitalize="characters"
                    className={`${FIELD} uppercase`}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bank-name" className={FIELD_LABEL}>Bank Name</label>
                  <input
                    id="bank-name"
                    type="text"
                    value={bankName}
                    onChange={e => setBankName(e.target.value)}
                    placeholder="e.g. SBI, HDFC"
                    className={FIELD}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {submitting ? <><Spinner className="h-4 w-4" /> Saving…</> : 'Link Account'}
              </button>
            </form>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={() => router.push('/onboarding/insurance')}
            className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => router.push('/onboarding/review')}
            className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            {accounts.length > 0 ? 'Next' : 'Skip for now'}
          </button>
        </div>

      </div>
    </div>
  )
}
