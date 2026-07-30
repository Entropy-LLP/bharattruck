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
    <div className={`rounded-2xl p-6 border transition-all duration-300 stat-hover relative overflow-hidden group
      ${accent
        ? 'dark:bg-[#161B25] bg-white dark:border-[#FF7A00]/30 border-[#FF7A00]/25 shadow-accent'
        : 'dark:bg-[#0E1117] bg-white dark:border-[#1E2535] border-[#E2E8F0] hover:dark:border-[#2A3449] hover:border-[#CBD5E1] hover:shadow-md dark:hover:shadow-[0_4px_24px_rgba(0,0,0,0.3)]'
      }
    `}>
      {/* Glow decoration */}
      <div className={`absolute top-0 right-0 w-28 h-28 rounded-bl-full pointer-events-none transition-all duration-300 group-hover:scale-125 group-hover:opacity-150 ${
        accent
          ? 'bg-[radial-gradient(circle_at_top_right,_rgba(255,122,0,0.12),_transparent)]'
          : 'bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.03),_transparent)]'
      }`} />

      {/* Top row: icon + trend */}
      <div className="flex items-start justify-between mb-5">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all group-hover:scale-105 shadow-sm
          ${accent
            ? 'shadow-accent'
            : 'dark:bg-[#161B25] bg-[#F8FAFC] dark:border-[#1E2535] border-[#E2E8F0] border'
          }`}
          style={accent ? { background: 'linear-gradient(135deg, #FF7A00, #FFB347)' } : {}}
        >
          <Icon size={18} className={accent ? 'text-white' : 'dark:text-[#8892A4] text-[#64748B]'} />
        </div>
        {trend && (
          <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border
            ${trend.up
              ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
              : 'text-rose-500 bg-rose-500/10 border-rose-500/20'
            }`}>
            {trend.up ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>

      {/* Value */}
      <p className={`text-4xl font-black mb-1.5 tracking-tight animate-count-up ${
        accent ? 'text-[#FF7A00]' : 'dark:text-white text-[#0F172A]'
      }`}>
        {value}
      </p>

      {/* Label */}
      <p className="text-sm font-semibold dark:text-[#8892A4] text-[#64748B]">{label}</p>

      {/* Sub */}
      {sub && (
        <p className="text-xs dark:text-[#434D5E] text-[#94A3B8] mt-1.5 font-medium">{sub}</p>
      )}

      {/* Bottom accent line for accent cards */}
      {accent && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-2xl"
          style={{ background: 'linear-gradient(90deg, #FF7A00, #FFB347, transparent)' }} />
      )}
    </div>
  )
}
