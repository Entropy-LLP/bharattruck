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
    <div className="px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-[414px]">

        {/* Avatar preview */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center mb-2">
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
          <p className="text-xs text-gray-400">Step 1 — Tell us about yourself</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">

          {/* Full name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="full-name" className="text-sm font-medium text-gray-700">
              Full Name <span className="text-blue-600">*</span>
            </label>
            <input
              id="full-name"
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="e.g. Rajesh Kumar"
              required
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow"
            />
          </div>

          {/* Photo URL — temporary until file upload */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="photo-url" className="text-sm font-medium text-gray-700">
              Profile Photo URL
              <span className="text-gray-400 text-xs font-normal ml-1">(optional)</span>
            </label>
            <input
              id="photo-url"
              type="url"
              value={photoUrl}
              onChange={e => setPhotoUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow"
            />
            <p className="text-xs text-gray-400">File upload coming soon — paste a URL for now</p>
          </div>

          {/* Languages */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">
              Languages Spoken <span className="text-blue-600">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map(lang => {
                const selected = languages.includes(lang)
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => toggleLanguage(lang)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      selected
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    {lang}
                  </button>
                )
              })}
            </div>
            {languages.length > 0 && (
              <p className="text-xs text-blue-600 mt-1">{languages.length} selected</p>
            )}
          </div>

          {/* Home base city */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="home-city" className="text-sm font-medium text-gray-700">
              Home Base City <span className="text-blue-600">*</span>
            </label>
            <input
              id="home-city"
              type="text"
              value={homeBaseCity}
              onChange={e => setHomeBaseCity(e.target.value)}
              placeholder="e.g. Mumbai, Nagpur, Delhi"
              required
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow"
            />
            <p className="text-xs text-gray-400">Where you usually start your trips from</p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-2">
            <button
              type="button"
              onClick={() => router.push('/onboarding/vehicle')}
              className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Skip for now
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {submitting ? <><Spinner className="h-4 w-4" /> Saving…</> : 'Next'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
