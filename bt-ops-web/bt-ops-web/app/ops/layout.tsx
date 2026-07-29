import { Sidebar } from '@/components/sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import { Bell } from 'lucide-react'
import { OpsGuard } from '@/components/ops-guard'

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <OpsGuard>
    <div className="flex h-screen dark:bg-[#080A0F] bg-[#F8FAFC] overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <header className="h-14 shrink-0 flex items-center justify-between px-6
          dark:border-[#1E2535] border-[#E2E8F0] border-b
          dark:bg-[#080A0F]/90 bg-white/90 backdrop-blur-md relative">

          {/* Top bar gradient line */}
          <div className="absolute top-0 left-0 right-0 h-px opacity-30"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,122,0,0.6) 30%, rgba(255,122,0,0.3) 70%, transparent)' }} />

          {/* Breadcrumb / page context (empty div keeps flexbox happy) */}
          <div />

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {/* Notification bell */}
            <button className="relative p-2 rounded-xl transition-all
              dark:text-[#8892A4] dark:hover:text-white dark:hover:bg-[#161B25]
              text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9]
              border dark:border-[#1E2535] border-transparent hover:border-[#E2E8F0] dark:hover:border-[#1E2535]">
              <Bell size={16} />
              {/* Badge */}
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                style={{ background: '#FF7A00', boxShadow: '0 0 6px rgba(255,122,0,0.6)' }} />
            </button>

            <ThemeToggle />

            {/* Divider */}
            <div className="w-px h-5 dark:bg-[#1E2535] bg-[#E2E8F0]" />

            {/* Avatar */}
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-black cursor-pointer shadow-sm hover:scale-105 transition-transform"
              style={{ background: 'linear-gradient(135deg, #FF7A00, #FFB347)' }}
              title="Admin User"
            >
              A
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
    </OpsGuard>
  )
}
