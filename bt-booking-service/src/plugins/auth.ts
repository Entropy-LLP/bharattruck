import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import jwt from 'jsonwebtoken'
import type { AuthenticatedUser } from '../lib/types.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser
  }
}

interface AuthJwtPayload extends jwt.JwtPayload {
  userId: string
  role: string
  phone?: string
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (req, reply) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return reply.status(401).send({ success: false, error: 'Missing Bearer token' })
    }

    const token = header.slice(7)
    let payload: AuthJwtPayload

    try {
      payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthJwtPayload
    } catch {
      return reply.status(401).send({ success: false, error: 'Invalid or expired token' })
    }

    if (!payload.userId) {
      return reply.status(401).send({ success: false, error: 'Token missing userId claim' })
    }

    req.user = {
      userId: payload.userId,
      role:   payload.role as AuthenticatedUser['role'],
    }
  })
}

export default fp(authPlugin)
