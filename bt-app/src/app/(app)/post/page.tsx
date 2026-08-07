import { ComingSoon } from '@/components/coming-soon'

// ship surface — grafted in Phase 2 (Post a Load: booking create, advisory pricing,
// quote-lock). Shown to everyone (ship is ungated) as a placeholder until it lands.
export default function PostLoadPage() {
  return (
    <ComingSoon
      title="Post a Load"
      subtitle="Create a booking and take it to the marketplace or your own fleet"
    />
  )
}
