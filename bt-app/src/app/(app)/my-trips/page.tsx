import { ComingSoon } from '@/components/coming-soon'

// drive surface — grafted in Phase 3 (My Trips: won/assigned trips to drive,
// navigation deep-link, POD capture). Shown only to a human with the 'drive'
// capability (a drivers row) as a placeholder until it lands.
export default function MyTripsPage() {
  return (
    <ComingSoon
      title="My Trips"
      subtitle="Trips assigned to you to drive, navigation, and delivery capture"
    />
  )
}
