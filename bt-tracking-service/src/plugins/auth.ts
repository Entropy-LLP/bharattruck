import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import jwt from 'jsonwebtoken'
import type { AuthenticatedUser } from '../lib/types.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser
  }
}

interface CustomJwtPayload {
  userId: string
  role: string
  iat?: number
  exp?: number
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (req, reply) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return reply.status(401).send({ success: false, error: 'Missing Bearer token' })
    }

    const token = header.slice(7)
    let payload: CustomJwtPayload

    try {
      payload = jwt.verify(token, process.env.JWT_SECRET!) as CustomJwtPayload
    } catch {
      return reply.status(401).send({ success: false, error: 'Invalid or expired token' })
    }

    if (!payload.userId || !payload.role) {
      return reply.status(401).send({ success: false, error: 'Token missing required claims' })
    }

    req.user = {
      userId: payload.userId,
      role: payload.role as AuthenticatedUser['role'],
    }
  })
}

export default fp(authPlugin)
