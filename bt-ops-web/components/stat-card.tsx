import { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string
  sub?: string
  icon: LucideIcon
  trend?: { value: string; up: boolean }
  accent?: boolean
}

export function StatCard({ label, value, sub, icon: Icon, trend, accent }: StatCardProps) {
  return (
    <div className={`rounded-xl p-5 border transition-all hover:scale-[1.01]
      dark:bg-[#111111] bg-white
      dark:border-[#2A2A2A] border-[#E4E4E7]
      ${accent ? 'dark:border-[#F97316]/30 border-[#F97316]/40' : ''}
    `}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center
          ${accent
            ? 'bg-[#F97316] text-white'
            : 'dark:bg-[#1A1A1A] bg-[#F4F4F5] dark:text-[#888] text-[#71717A]'
          }`}>
          <Icon size={16} />
        </div>
        {trend && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
            ${trend.up
              ? 'text-[#22C55E] bg-[#22C55E]/10'
              : 'text-[#EF4444] bg-[#EF4444]/10'
            }`}>
            {trend.up ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold dark:text-white text-[#09090B] mb-1">{value}</p>
      <p className="text-sm dark:text-[#888] text-[#71717A]">{label}</p>
      {sub && <p className="text-xs dark:text-[#555] text-[#A1A1AA] mt-1">{sub}</p>}
    </div>
  )
}
