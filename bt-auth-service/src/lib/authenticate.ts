import type { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'

export type JwtPayload = {
  userId: string
  /**
   * OPTIONAL, matching verifyJwt() in @bharattruck/shared/auth.
   *
   * Tokens are still MINTED with a role (issueTokens/`/refresh` are unchanged) — every deployed
   * client and every other service reads it, so removing it now would be a breaking change. What
   * is dropped is the REQUIREMENT to present one.
   *
   * WHY: a role baked into a token is a persona frozen at sign-in time. It is already stale the
   * moment the human buys a truck or is hired by a fleet, and under the emergent-persona model
   * (@bharattruck/shared/personas) capability is COMPUTED per request from owned assets, so the
   * claim has no authorization job left to do. When token minting eventually stops carrying it,
   * every session issued before that day must keep working — a service that 401s on a missing
   * `role` would sign out the entire live user base on deploy. Relaxing the check first is what
   * makes that later change a non-event.
   */
  role?: string
}

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ success: false, error: 'Authorization header required' })
    return
  }

  const token = header.slice(7)
  let payload: JwtPayload

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  } catch {
    reply.code(401).send({ success: false, error: 'Invalid or expired token' })
    return
  }

  // `userId` is the ONLY claim that identifies anybody, so it is the only one required here.
  if (!payload.userId) {
    reply.code(401).send({ success: false, error: 'Token missing required claims' })
    return
  }

  request.user = { userId: payload.userId, role: payload.role }
}
