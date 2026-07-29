'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { getVehicles, createVehicle } from '@/lib/api'
import type { Vehicle } from '@/lib/types'
import Spinner from '@/components/spinner'

const BODY_TYPES = [
  { value: 'open', label: 'Open Body' },
  { value: 'closed', label: 'Closed / Container' },
  { value: 'container', label: 'ISO Container' },
  { value: 'flatbed', label: 'Flatbed' },
  { value: 'tanker', label: 'Tanker' },
  { value: 'refrigerated', label: 'Refrigerated' },
] as const

const AXLE_CONFIGS = [
  { value: '4x2', label: '4x2 — 2 axle (Mini / LCV)' },
  { value: '6x2', label: '6x2 — 3 axle' },
  { value: '6x4', label: '6x4 — 3 axle (HCV)' },
  { value: '8x4', label: '8x4 — 4 axle' },
  { value: '10x2', label: '10x2 — Multi-axle trailer' },
] as const

const FUEL_TYPES = ['Diesel', 'Petrol', 'CNG', 'Electric', 'LNG'] as const

type BodyType = (typeof BODY_TYPES)[number]['value']
type AxleConfig = (typeof AXLE_CONFIGS)[number]['value']

export default function VehicleStep() {
  const router = useRouter()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [rcNumber, setRcNumber] = useState('')
  const [capacityTons, setCapacityTons] = useState('')
  const [bodyType, setBodyType] = useState<BodyType | ''>('')
  const [axleConfig, setAxleConfig] = useState<AxleConfig | ''>('')
  const [makerModel, setMakerModel] = useState('')
  const [fuelType, setFuelType] = useState('')
  const [rcExpiry, setRcExpiry] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const data = await getVehicles()
        setVehicles(data.vehicles)
        if (data.vehicles.length === 0) setShowForm(true)
      } catch {
        setShowForm(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function resetForm() {
    setRcNumber('')
    setCapacityTons('')
    setBodyType('')
    setAxleConfig('')
    setMakerModel('')
    setFuelType('')
    setRcExpiry('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!rcNumber.trim()) {
      toast.error('RC number is required')
      return
    }

    setSubmitting(true)
    try {
      const { vehicle } = await createVehicle({
        rc_number: rcNumber.trim().toUpperCase(),
        ...(capacityTons ? { capacity_tons: parseFloat(capacityTons) } : {}),
        ...(bodyType ? { body_type: bodyType } : {}),
        ...(axleConfig ? { axle_config: axleConfig } : {}),
        ...(makerModel.trim() ? { maker_model: makerModel.trim() } : {}),
        ...(fuelType ? { fuel_type: fuelType.toLowerCase() } : {}),
        ...(rcExpiry ? { rc_expiry: rcExpiry } : {}),
      })
      setVehicles(prev => [vehicle, ...prev])
      resetForm()
      setShowForm(false)
      toast.success('Vehicle registered')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to register vehicle'
      toast.error(message)
    } finally {
      setSubmitting(false)
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
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-2">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0h-3m3 0h2m-2 0V9a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16" />
            </svg>
          </div>
          <p className="text-xs text-gray-400">Step 2 — Register your vehicle(s)</p>
        </div>

        {/* Existing vehicles */}
        {vehicles.length > 0 && (
          <div className="flex flex-col gap-3">
            {vehicles.map(v => (
              <div
                key={v.id}
                className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900 text-sm">{v.rc_number}</span>
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold ${
                      v.rc_status === 'verified'
                        ? 'bg-green-50 text-green-700'
                        : v.rc_status === 'rejected'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-yellow-50 text-yellow-700'
                    }`}
                  >
                    {v.rc_status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  {v.body_type && <span className="capitalize">{v.body_type}</span>}
                  {v.capacity_tons && <span>{v.capacity_tons}t</span>}
                  {v.axle_config && <span>{v.axle_config}</span>}
                  {v.maker_model && <span>{v.maker_model}</span>}
                  {v.fuel_type && <span className="capitalize">{v.fuel_type}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add vehicle button */}
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="w-full rounded-xl border-2 border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add another vehicle
          </button>
        )}

        {/* Vehicle form */}
        {showForm && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">
                {vehicles.length === 0 ? 'Register Vehicle' : 'Add Vehicle'}
              </h3>
              {vehicles.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm() }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">

              {/* RC Number */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="rc-number" className="text-sm font-medium text-gray-700">
                  RC Number <span className="text-blue-600">*</span>
                </label>
                <input
                  id="rc-number"
                  type="text"
                  value={rcNumber}
                  onChange={e => setRcNumber(e.target.value)}
                  placeholder="e.g. MH 04 AB 1234"
                  required
                  autoCapitalize="characters"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow uppercase"
                />
              </div>

              {/* Body type + Axle config row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="body-type" className="text-sm font-medium text-gray-700">Body Type</label>
                  <select
                    id="body-type"
                    value={bodyType}
                    onChange={e => setBodyType(e.target.value as BodyType)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow appearance-none"
                  >
                    <option value="">Select</option>
                    {BODY_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="axle-config" className="text-sm font-medium text-gray-700">Axle Config</label>
                  <select
                    id="axle-config"
                    value={axleConfig}
                    onChange={e => setAxleConfig(e.target.value as AxleConfig)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow appearance-none"
                  >
                    <option value="">Select</option>
                    {AXLE_CONFIGS.map(a => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Capacity + Fuel row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="capacity" className="text-sm font-medium text-gray-700">Capacity (tons)</label>
                  <input
                    id="capacity"
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    value={capacityTons}
                    onChange={e => setCapacityTons(e.target.value)}
                    placeholder="e.g. 9.5"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="fuel-type" className="text-sm font-medium text-gray-700">Fuel Type</label>
                  <select
                    id="fuel-type"
                    value={fuelType}
                    onChange={e => setFuelType(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow appearance-none"
                  >
                    <option value="">Select</option>
                    {FUEL_TYPES.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Maker/Model */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="maker-model" className="text-sm font-medium text-gray-700">Make & Model</label>
                <input
                  id="maker-model"
                  type="text"
                  value={makerModel}
                  onChange={e => setMakerModel(e.target.value)}
                  placeholder="e.g. Tata 407, Ashok Leyland Dost"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow"
                />
              </div>

              {/* RC Expiry */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="rc-expiry" className="text-sm font-medium text-gray-700">RC Expiry Date</label>
                <input
                  id="rc-expiry"
                  type="date"
                  value={rcExpiry}
                  onChange={e => setRcExpiry(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {submitting ? <><Spinner className="h-4 w-4" /> Saving…</> : 'Register Vehicle'}
              </button>
            </form>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={() => router.push('/onboarding/personal')}
            className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              if (vehicles.length === 0) {
                toast.error('Register at least one vehicle to continue')
                return
              }
              router.push('/onboarding/license')
            }}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 active:scale-[0.98] transition-all"
          >
            Next
          </button>
        </div>

      </div>
    </div>
  )
}
