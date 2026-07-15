'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { getOnboardingProfile, updateDriverProfile } from '@/lib/api'
import Spinner from '@/components/spinner'

const LANGUAGES = [
  'Hindi', 'English', 'Punjabi', 'Tamil', 'Telugu',
  'Kannada', 'Marathi', 'Bengali', 'Gujarati', 'Odia',
  'Malayalam', 'Urdu', 'Assamese', 'Rajasthani',
] as const

export default function PersonalProfileStep() {
  const { user } = useAuth()
  const router = useRouter()

  const [fullName, setFullName] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [homeBaseCity, setHomeBaseCity] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Pre-fill from existing profile
  useEffect(() => {
    async function load() {
      try {
        const data = await getOnboardingProfile()
        if (data.user?.full_name) setFullName(data.user.full_name)
        if (data.driver?.photo_url) setPhotoUrl(data.driver.photo_url)
        if (data.driver?.languages?.length) setLanguages(data.driver.languages)
        if (data.driver?.home_base_city) setHomeBaseCity(data.driver.home_base_city)
      } catch {
        // First time — fields stay empty
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function toggleLanguage(lang: string) {
    setLanguages(prev =>
      prev.includes(lang)
        ? prev.filter(l => l !== lang)
        : [...prev, lang]
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!fullName.trim()) {
      toast.error('Full name is required')
      return
    }
    if (languages.length === 0) {
      toast.error('Select at least one language')
      return
    }
    if (!homeBaseCity.trim()) {
      toast.error('Home base city is required')
      return
    }

    setSubmitting(true)
    try {
      await updateDriverProfile({
        full_name: fullName.trim(),
        ...(photoUrl.trim() ? { photo_url: photoUrl.trim() } : {}),
        languages,
        home_base_city: homeBaseCity.trim(),
      })
      toast.success('Profile saved')
      router.push('/onboarding/vehicle')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save profile'
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
    <div className="px-4 py-8 flex flex-col items-center bg-gray-50/50 min-h-screen">
      <div className="w-full max-w-[450px] bg-white rounded-2xl border border-gray-200 p-6 premium-shadow">
        
        {/* Onboarding Stepper */}
        <div className="w-full mb-8">
          <div className="flex items-center justify-between relative px-2">
            <div className="absolute top-4 left-0 right-0 h-[2px] bg-gray-100 -translate-y-1/2 z-0" />
            <div className="absolute top-4 left-0 w-[0%] h-[2px] bg-blue-600 -translate-y-1/2 z-0 transition-all duration-500" />
            {[
              { id: 'personal', label: 'Personal', active: true },
              { id: 'vehicle', label: 'Vehicle', active: false },
              { id: 'license', label: 'License', active: false },
              { id: 'insurance', label: 'Insurance', active: false },
              { id: 'bank', label: 'Bank', active: false },
              { id: 'review', label: 'Review', active: false }
            ].map((s, idx) => {
              const isCurrent = s.id === 'personal'
              return (
                <div key={s.id} className="flex flex-col items-center relative z-10">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    isCurrent
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100 scale-105'
                      : 'bg-white text-gray-400 border border-gray-200'
                  }`}>
                    {idx + 1}
                  </div>
                  <span className="text-[10px] font-semibold text-gray-400 mt-1.5 hidden sm:block">{s.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Avatar preview */}
        <div className="flex flex-col items-center mb-6 border-b border-gray-100 pb-5">
          <div className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center mb-2 premium-shadow relative overflow-hidden group">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt="Profile"
                className="w-20 h-20 rounded-full object-cover"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <span className="text-white font-bold text-2xl">
                {fullName ? fullName.charAt(0).toUpperCase() : user?.full_name?.charAt(0)?.toUpperCase() || '?'}
              </span>
            )}
          </div>
          <h2 className="text-lg font-bold text-gray-900">Personal Information</h2>
          <p className="text-xs text-gray-500">Step 1 — Tell us about yourself to activate your account</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">

          {/* Full name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="full-name" className="text-sm font-semibold text-gray-700">
              Full Name <span className="text-blue-600">*</span>
            </label>
            <input
              id="full-name"
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="e.g. Rajesh Kumar"
              required
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white focus:border-transparent transition-all"
            />
          </div>

          {/* Photo URL — temporary until file upload */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="photo-url" className="text-sm font-semibold text-gray-700">
              Profile Photo URL
              <span className="text-gray-400 text-xs font-normal ml-1">(optional)</span>
            </label>
            <input
              id="photo-url"
              type="url"
              value={photoUrl}
              onChange={e => setPhotoUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white focus:border-transparent transition-all"
            />
            <p className="text-[11px] text-gray-400">File upload coming soon — paste a URL for now</p>
          </div>

          {/* Languages */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700">
              Languages Spoken <span className="text-blue-600">*</span>
            </label>
            <div className="flex flex-wrap gap-2 mt-1">
              {LANGUAGES.map(lang => {
                const selected = languages.includes(lang)
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => toggleLanguage(lang)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all active:scale-95 ${
                      selected
                        ? 'bg-blue-600 text-white border-blue-600 glow-blue'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-blue-200'
                    }`}
                  >
                    {lang}
                  </button>
                )
              })}
            </div>
            {languages.length > 0 && (
              <p className="text-xs text-blue-600 font-semibold mt-1">{languages.length} selected</p>
            )}
          </div>

          {/* Home base city */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="home-city" className="text-sm font-semibold text-gray-700">
              Home Base City <span className="text-blue-600">*</span>
            </label>
            <input
              id="home-city"
              type="text"
              value={homeBaseCity}
              onChange={e => setHomeBaseCity(e.target.value)}
              placeholder="e.g. Mumbai, Nagpur, Delhi"
              required
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white focus:border-transparent transition-all"
            />
            <p className="text-[11px] text-gray-400">Where you usually start your trips from</p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-4 border-t border-gray-100 pt-5">
            <button
              type="button"
              onClick={() => router.push('/onboarding/vehicle')}
              className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Skip
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 glow-blue"
            >
              {submitting ? 'Saving…' : 'Next Step'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
