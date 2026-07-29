import type { QuoteStatus } from './types'

export const quoteStatusConfig: Record<QuoteStatus, { label: string; color: string }> = {
  submitted: { label: 'Submitted', color: 'bg-yellow-100 text-yellow-800' },
  countered: { label: 'Countered', color: 'bg-orange-100 text-orange-800' },
  accepted:  { label: 'Accepted',  color: 'bg-green-100 text-green-800' },
  rejected:  { label: 'Rejected',  color: 'bg-red-100 text-red-800' },
  withdrawn: { label: 'Withdrawn', color: 'bg-gray-100 text-gray-500' },
  expired:   { label: 'Expired',   color: 'bg-gray-100 text-gray-500' },
}
