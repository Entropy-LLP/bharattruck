import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createFleetOwner, getFleetOwnerByUserId, requireFleetOwner, updateFleetOwner } from '../lib/fleet-repo.js'
import { FleetError, parseOrThrow } from '../lib/types.js'

// -----------------------------------------------------------
// ownerRoutes — the fleet party itself (mounted at /fleet/owners).
//
// fleet_owners.user_id is the ONLY link between a JWT and a tenant. It is written
// once, from req.user.userId, and is not patchable — re-pointing it would hand one
// account another fleet's entire estate.
// -----------------------------------------------------------

const OwnerProfileBody = z.object({
  company_name: z.string().trim().min(2, 'company_name must be at least 2 characters').max(120),
  gstin: z.string().trim().length(15, 'gstin must be 15 characters').optional(),
  pan: z.string().trim().length(10, 'pan must be 10 characters').optional(),
  contact_phone: z.string().trim().min(8).max(20).optional(),
  billing_address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  monthly_overhead_inr: z.number().min(0, 'monthly_overhead_inr cannot be negative').max(100_000_000).optional(),
})

const UpdateOwnerBody = OwnerProfileBody.partial().refine(
  body => Object.keys(body).length > 0,
  'No fields to update',
)

export async function ownerRoutes(app: FastifyInstance) {
  // POST /fleet/owners — register the fleet profile. D-27/D-32 DE-ROLE: any authenticated
  // user may create THEIR OWN fleet profile — becoming a fleet owner is a fact about
  // yourself, gated by nothing but identity. user_id is taken from the verified token and
  // never the body (see the file header), so one account can never mint another's; the
  // existence check below is the only guard, 409-ing a second registration for the same
  // account. (The idempotent sibling is POST /identity/fleet-owners/me in bt-auth-service.)
  app.post('/', async (req, reply) => {
    const body = parseOrThrow(OwnerProfileBody, req.body)
    const existing = await getFleetOwnerByUserId(req.user.userId)
    if (existing) {
      throw new FleetError('A fleet profile already exists for this account', 'CONFLICT', 409)
    }
    const owner = await createFleetOwner({ ...body, user_id: req.user.userId })
    return reply.status(201).send({ success: true, data: owner })
  })

  // GET /fleet/owners/me
  app.get('/me', async (req, reply) => {
    const owner = await requireFleetOwner(req.user)
    return reply.send({ success: true, data: owner })
  })

  // PATCH /fleet/owners/me
  app.patch('/me', async (req, reply) => {
    const owner = await requireFleetOwner(req.user)
    const patch = parseOrThrow(UpdateOwnerBody, req.body)
    const updated = await updateFleetOwner(owner.id, patch)
    return reply.send({ success: true, data: updated })
  })
}
