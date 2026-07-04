'use client'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="p-2 rounded-lg transition-colors
        dark:text-[#888] dark:hover:text-white dark:hover:bg-[#1A1A1A]
        text-[#71717A] hover:text-[#09090B] hover:bg-[#E4E4E7]"
      title="Toggle theme"
    >
      {theme === 'dark'
        ? <Sun size={18} />
        : <Moon size={18} />
      }
    </button>
  )
}
