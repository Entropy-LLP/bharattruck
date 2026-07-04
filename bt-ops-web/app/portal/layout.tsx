import { Sidebar } from '@/components/sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import { Bell } from 'lucide-react'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen dark:bg-[#09090B] bg-[#FAFAFA] overflow-hidden">
      <Sidebar role="fleet" />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 shrink-0 flex items-center justify-between px-6
          dark:border-[#2A2A2A] border-[#E4E4E7] border-b
          dark:bg-[#09090B]/80 bg-white/80 backdrop-blur-sm">
          <div />
          <div className="flex items-center gap-2">
            <button className="relative p-2 rounded-lg transition-colors
              dark:text-[#888] dark:hover:text-white dark:hover:bg-[#1A1A1A]
              text-[#71717A] hover:text-[#09090B] hover:bg-[#F4F4F5]">
              <Bell size={18} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#22C55E]" />
            </button>
            <ThemeToggle />
            <div className="w-8 h-8 rounded-full bg-[#22C55E]/20 flex items-center justify-center text-[#22C55E] text-xs font-bold ml-1">
              S
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
