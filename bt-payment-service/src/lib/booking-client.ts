import { PaymentError } from './errors.js'

// -----------------------------------------------------------
// BookingClient — payment-service's window into bt-booking-service.
// booking-service OWNS bookings + the state machine, so payment-service
// reads a booking for authorization/status (forwarding the actor's JWT,
// which also enforces shipper-ownership) and, after recording a
// settlement, asks booking-service to run completed → paid.
// -----------------------------------------------------------

export type BookingView = {
  id: string
  status: string
  shipper_id: string
  driver_id: string | null
  quoted_price: number
  final_price: number | null
}

export interface BookingClient {
  getBooking(bookingId: string, bearer: string): Promise<BookingView>
  markPaid(bookingId: string): Promise<{ status: string }>
}

async function readBody(res: Response): Promise<any> {
  return res.json().catch(() => ({}))
}

function mapCode(code: unknown): PaymentError['code'] {
  switch (code) {
    case 'FORBIDDEN': return 'FORBIDDEN'
    case 'NOT_FOUND': return 'NOT_FOUND'
    case 'INVALID_TRANSITION': return 'INVALID_STATE'
    default: return 'UPSTREAM_ERROR'
  }
}

export class HttpBookingClient implements BookingClient {
  constructor(private readonly baseUrl: string, private readonly internalSecret: string) {}

  async getBooking(bookingId: string, bearer: string): Promise<BookingView> {
    const res = await fetch(`${this.baseUrl}/bookings/${bookingId}`, { headers: { authorization: bearer } })
    const body = await readBody(res)
    if (!res.ok) {
      throw new PaymentError(body?.error ?? 'Failed to read booking', mapCode(body?.code), res.status)
    }
    return body.data as BookingView
  }

  async markPaid(bookingId: string): Promise<{ status: string }> {
    const res = await fetch(`${this.baseUrl}/internal/bookings/${bookingId}/mark-paid`, {
      method: 'POST',
      headers: { 'x-internal-secret': this.internalSecret },
    })
    const body = await readBody(res)
    if (!res.ok) {
      throw new PaymentError(body?.error ?? 'Failed to mark booking paid', mapCode(body?.code), res.status)
    }
    return { status: body.data?.status }
  }
}

export function defaultBookingClient(): BookingClient {
  const baseUrl = process.env.BOOKING_SERVICE_URL
  const secret = process.env.INTERNAL_SERVICE_SECRET
  if (!baseUrl) throw new Error('BOOKING_SERVICE_URL must be set')
  if (!secret) throw new Error('INTERNAL_SERVICE_SECRET must be set')
  return new HttpBookingClient(baseUrl, secret)
}
