import type { BookingStatus, QuoteStatus } from './types'

// Kept identical to shipper/src/lib/status.ts so a booking reads the same colour in
// the shipper app and the fleet console.
export const bookingStatusConfig: Record<BookingStatus, { label: string; color: string }> = {
  pending:     { label: 'Pending',     color: 'bg-yellow-100 text-yellow-800' },
  negotiating: { label: 'Negotiating', color: 'bg-blue-100 text-blue-800' },
  accepted:    { label: 'Accepted',    color: 'bg-green-100 text-green-800' },
  in_transit:  { label: 'In transit',  color: 'bg-purple-100 text-purple-800' },
  // Driver says delivered, receiver could not confirm — ops closes it (migration 0025).
  delivery_asserted: { label: 'Awaiting Confirmation', color: 'bg-amber-100 text-amber-800' },
  completed:   { label: 'Delivered',   color: 'bg-gray-100 text-gray-600' },
  cancelled:   { label: 'Cancelled',   color: 'bg-red-100 text-red-800' },
  paid:        { label: 'Paid',        color: 'bg-emerald-100 text-emerald-800' },
}

export const quoteStatusConfig: Record<QuoteStatus, { label: string; color: string }> = {
  submitted: { label: 'Submitted', color: 'bg-yellow-100 text-yellow-800' },
  countered: { label: 'Countered', color: 'bg-orange-100 text-orange-800' },
  accepted:  { label: 'Accepted',  color: 'bg-green-100 text-green-800' },
  rejected:  { label: 'Rejected',  color: 'bg-red-100 text-red-800' },
  withdrawn: { label: 'Withdrawn', color: 'bg-gray-100 text-gray-500' },
  expired:   { label: 'Expired',   color: 'bg-gray-100 text-gray-500' },
}
