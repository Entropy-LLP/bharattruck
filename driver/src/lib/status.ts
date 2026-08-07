import type { BookingStatus, QuoteStatus } from './types'

export const quoteStatusConfig: Record<QuoteStatus, { label: string; color: string }> = {
  submitted: { label: 'Submitted', color: 'bg-yellow-100 text-yellow-800' },
  countered: { label: 'Countered', color: 'bg-orange-100 text-orange-800' },
  accepted:  { label: 'Accepted',  color: 'bg-green-100 text-green-800' },
  rejected:  { label: 'Rejected',  color: 'bg-red-100 text-red-800' },
  withdrawn: { label: 'Withdrawn', color: 'bg-gray-100 text-gray-500' },
  expired:   { label: 'Expired',   color: 'bg-gray-100 text-gray-500' },
}

/**
 * Trip status as the DRIVER reads it — phrased as what to do next, not as the
 * lifecycle name. A fleet driver's list is assigned trips rather than a load
 * board, so this is the column that matters to them: money is masked for them
 * (founder Q16) and there is nothing to bid on.
 */
export const bookingStatusConfig: Record<BookingStatus, { label: string; color: string }> = {
  pending:    { label: 'Awaiting award', color: 'bg-secondary text-muted-foreground' },
  negotiating:{ label: 'In negotiation', color: 'bg-amber-500/15 text-amber-500' },
  accepted:   { label: 'Ready to start', color: 'bg-emerald-500/15 text-emerald-500' },
  in_transit: { label: 'In transit',     color: 'bg-purple-500/15 text-purple-400' },
  // Delivered, but nobody confirmed it — ops has to close it, and the driver should
  // read it as "waiting on us", not as done.
  delivery_asserted: { label: 'Awaiting confirmation', color: 'bg-amber-500/15 text-amber-500' },
  completed:  { label: 'Delivered',      color: 'bg-emerald-500/15 text-emerald-500' },
  paid:       { label: 'Paid',           color: 'bg-emerald-500/15 text-emerald-500' },
  cancelled:  { label: 'Cancelled',      color: 'bg-secondary text-muted-foreground' },
}
