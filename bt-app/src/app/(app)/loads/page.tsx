import { ComingSoon } from '@/components/coming-soon'

// ship surface — grafted in Phase 2 (My Loads: posted loads, live shipment map,
// receiver-side POD, documents). Shown to everyone (ship is ungated) as a placeholder
// until the surface lands.
export default function LoadsPage() {
  return (
    <ComingSoon
      title="My Loads"
      subtitle="Loads you've posted, their bids, and delivery status"
    />
  )
}
