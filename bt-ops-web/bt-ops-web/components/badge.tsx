type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'muted' | 'accent'

interface BadgeProps {
  variant: BadgeVariant
  children: React.ReactNode
  dot?: boolean
}

const styles: Record<BadgeVariant, string> = {
  success: 'bg-[#22C55E]/10 text-[#22C55E] border-[#22C55E]/20',
  warning: 'bg-[#FBBF24]/10 text-[#FBBF24] border-[#FBBF24]/20',
  error:   'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20',
  info:    'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/20',
  muted:   'dark:bg-[#1A1A1A] dark:text-[#888] dark:border-[#2A2A2A] bg-[#F4F4F5] text-[#71717A] border-[#E4E4E7]',
  accent:  'bg-[#F97316]/10 text-[#F97316] border-[#F97316]/20',
}

export function Badge({ variant, children, dot }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold
      px-2.5 py-1 rounded-full border ${styles[variant]}`}>
      {dot && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      )}
      {children}
    </span>
  )
}
