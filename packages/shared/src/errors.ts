/**
 * Canonical error type + wire envelope for ALL BharatTruck services.
 *
 * Reused from here — do NOT re-declare per-service `TrackingError`/`BookingError`/etc.
 * Every service throws `AppError` and serialises with `errorEnvelope()`, so the API surface
 * (and the frontend/gateway that consume it) sees one consistent shape everywhere.
 */

/** Machine-readable error code. Extend the union as real codes are added — keep it a closed set. */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL'

/** The single error envelope every service returns on failure. snake_case-friendly + stable. */
export interface ErrorEnvelope {
  success: false
  error: string
  code: ErrorCode
}

/** The success envelope counterpart, so `{ success, data }` is uniform across services. */
export interface SuccessEnvelope<T> {
  success: true
  data: T
}

export type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope

/**
 * Application error carrying an HTTP status + machine code. Throw this anywhere; a shared
 * Fastify error handler (see `@bharattruck/shared/http`, extracted during migration) maps it
 * to the envelope + status. 4xx are client-safe; 5xx messages are redacted at the boundary.
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  /** true for expected 4xx (message is safe to return); false for 5xx (redact at the edge). */
  readonly expose: boolean

  constructor(message: string, code: ErrorCode, statusCode: number) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.expose = statusCode < 500
  }

  // Ergonomic constructors for the common cases (match the status codes services already use).
  static validation(msg = 'Validation error') { return new AppError(msg, 'VALIDATION_ERROR', 400) }
  static unauthenticated(msg = 'Unauthenticated') { return new AppError(msg, 'UNAUTHENTICATED', 401) }
  static forbidden(msg = 'Forbidden') { return new AppError(msg, 'FORBIDDEN', 403) }
  static notFound(msg = 'Not found') { return new AppError(msg, 'NOT_FOUND', 404) }
  static conflict(msg = 'Conflict') { return new AppError(msg, 'CONFLICT', 409) }
  static invalidTransition(msg = 'Invalid state transition') { return new AppError(msg, 'INVALID_TRANSITION', 409) }
  static rateLimited(msg = 'Too many requests') { return new AppError(msg, 'RATE_LIMITED', 429) }
}

/** Serialise any thrown value into the wire error envelope. 5xx messages are redacted. */
export function errorEnvelope(err: unknown): { status: number; body: ErrorEnvelope } {
  if (err instanceof AppError) {
    return {
      status: err.statusCode,
      body: { success: false, error: err.expose ? err.message : 'Internal server error', code: err.code },
    }
  }
  return { status: 500, body: { success: false, error: 'Internal server error', code: 'INTERNAL' } }
}

/** Wrap a value in the success envelope. */
export function ok<T>(data: T): SuccessEnvelope<T> {
  return { success: true, data }
}
