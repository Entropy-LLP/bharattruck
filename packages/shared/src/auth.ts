/**
 * Shared auth primitives — HS256 JWT verification + the identity contract.
 * Reused from here so services stop copy-pasting the same verify logic.
 *
 * IDENTITY CONTRACT (do not violate):
 *   • `userId` is `public.users.id` (the JWT `userId` claim).
 *   • `drivers.id` is a SEPARATE row, resolved via getDriverByUserId.
 *   • `bookings.driver_id`, `quotes.driver_id`, and Redis `loc:*` keys reference
 *     `drivers.id`, NOT `users.id`.
 *
 * Framework-agnostic on purpose: services keep their own thin Fastify hook that
 * calls verifyJwt(), so @bharattruck/shared does not depend on Fastify.
 */
import jwt from 'jsonwebtoken'

export type UserRole = 'shipper' | 'driver' | 'admin'

export type AuthenticatedUser = {
  userId: string
  role: UserRole
}

export class JwtError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JwtError'
  }
}

/** Pull a bearer token from an Authorization header value, or null if absent/malformed. */
export function extractBearer(header: string | undefined | null): string | null {
  return header && header.startsWith('Bearer ') ? header.slice(7) : null
}

/**
 * Verify an HS256 token with the shared secret and return the identity.
 * Throws JwtError on a bad/expired token or a missing `userId` claim.
 */
export function verifyJwt(token: string, secret: string): AuthenticatedUser {
  let payload: jwt.JwtPayload | string
  try {
    payload = jwt.verify(token, secret)
  } catch {
    throw new JwtError('Invalid or expired token')
  }
  if (typeof payload !== 'object' || payload === null || typeof (payload as any).userId !== 'string') {
    throw new JwtError('Token missing userId claim')
  }
  return { userId: (payload as any).userId, role: (payload as any).role as UserRole }
}
