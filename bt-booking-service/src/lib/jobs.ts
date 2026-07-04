// ============================================================
// src/lib/jobs.ts
//
// Responsibility: async background job definitions.
//   All functions are stubs — implement bodies when the respective
//   integration (FCM, BullMQ workers, Polygon) is ready.
//
// Each function should enqueue a BullMQ job rather than doing
// the work inline, so the HTTP response is not blocked.
// ============================================================

// -----------------------------------------------------------
// notifyDriver
// Sends a push notification (FCM) or SMS to the assigned driver
// when a booking reaches ASSIGNED or a state change requires action.
// -----------------------------------------------------------

export async function notifyDriver(bookingId: string): Promise<void> {
  // TODO: enqueue a BullMQ job → 'notifications' queue, name: 'notify-driver'
  // TODO: worker reads driver FCM token from driver-service and sends via FCM/SMS
  void bookingId
}

// -----------------------------------------------------------
// notifyShipper
// Informs the shipper of a state change on their booking.
// `event` is a human-readable label, e.g. 'ASSIGNED' or 'IN_TRANSIT'.
// -----------------------------------------------------------

export async function notifyShipper(bookingId: string, event: string): Promise<void> {
  // TODO: enqueue a BullMQ job → 'notifications' queue, name: 'notify-shipper'
  // TODO: worker looks up shipper contact details and sends push/email/SMS
  void bookingId
  void event
}

// -----------------------------------------------------------
// anchorToBlockchain
// Records an immutable hash of the booking event on-chain.
//
// // BLOCKCHAIN: blocked — wire this up when Polygon integration is ready
// -----------------------------------------------------------

export async function anchorToBlockchain(
  bookingId: string,
  payload: object,
): Promise<void> {
  // BLOCKCHAIN: blocked — wire this up when Polygon integration is ready
  // TODO: hash payload with keccak256
  // TODO: enqueue a BullMQ job → 'anchor' queue, name: 'anchor-event'
  // TODO: worker calls the LogisticOS anchor contract on Polygon
  void bookingId
  void payload
}

// -----------------------------------------------------------
// expireAuction
// Schedules an auction expiry job to fire at auction_deadline.
// When it fires, the worker sets the booking status to 'expired'
// and marks all open/countered quotes as 'expired'.
// -----------------------------------------------------------

export async function expireAuction(bookingId: string): Promise<void> {
  // TODO: enqueue BullMQ delayed job → 'auctions' queue, name: 'expire-auction'
  // TODO: worker should set booking status='expired', all open quotes status='expired'
  void bookingId
}

// -----------------------------------------------------------
// notifyNewQuote
// Sends a notification to the shipper when a new quote is
// submitted on their booking.
// -----------------------------------------------------------

export async function notifyNewQuote(bookingId: string, driverName: string): Promise<void> {
  // TODO: enqueue BullMQ job → 'notifications' queue, name: 'notify-new-quote'
  void bookingId
  void driverName
}
