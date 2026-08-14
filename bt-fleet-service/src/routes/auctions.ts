import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireFleetOwner } from '../lib/fleet-repo.js'
import { listOpenAuctions, listFleetBids } from '../lib/auctions.js'
import { parseOrThrow } from '../lib/types.js'

// -----------------------------------------------------------
// auctionRoutes — the fleet's read side of bidding (mounted at /fleet).
//
// Two endpoints, and between them they close the gap the console has carried since
// the fleet persona shipped:
//
//   GET /fleet/auctions — open loads this fleet may bid on. There was no such list.
//   GET /fleet/bids     — every bid this fleet has out. There was no such list either.
//
// `/fleet/bookings` could only ever answer "auctions already won", because
// `bookings.fleet_owner_id` is written at AWARD time. Live bids, countered bids and
// lost bids were simply unreachable from this console.
//
// Both go through requireFleetOwner, so the tenant is resolved from the JWT and never
// taken from a query parameter.
// -----------------------------------------------------------

const OpenAuctionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /**
   * Expired auctions are hidden by default: bidding on one 409s at
   * bt-booking-service, so surfacing them would be a board of dead buttons. The
   * flag exists so the UI can still show what was missed.
   */
  include_expired: z.coerce.boolean().default(false),
})

const BidsQuery = z.object({
  status: z.enum(['submitted', 'countered', 'accepted', 'rejected', 'withdrawn']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function auctionRoutes(app: FastifyInstance) {
  // GET /fleet/auctions — the open load board.
  app.get('/auctions', async (req, reply) => {
    const owner = await requireFleetOwner(req.user)
    const q = parseOrThrow(OpenAuctionsQuery, req.query)

    // Two DIFFERENT ids off the same owner row, and swapping them silently breaks the
    // board: `owner.id` (fleet_owners.id) scopes which bid is "mine", while
    // `owner.user_id` (users.id) is what bookings.shipper_id holds and is therefore the
    // only thing that can identify the caller's own loads for exclusion.
    const auctions = await listOpenAuctions(owner.id, {
      limit: q.limit,
      offset: q.offset,
      includeExpired: q.include_expired,
      excludeShipperUserId: owner.user_id,
    })

    return reply.send({
      success: true,
      data: {
        fleet_owner_id: owner.id,
        count: auctions.length,
        auctions,
      },
    })
  })

  // GET /fleet/bids — every bid this fleet has placed, with its load attached.
  app.get('/bids', async (req, reply) => {
    const owner = await requireFleetOwner(req.user)
    const q = parseOrThrow(BidsQuery, req.query)

    const bids = await listFleetBids(owner.id, {
      status: q.status,
      limit: q.limit,
      offset: q.offset,
    })

    return reply.send({
      success: true,
      data: {
        fleet_owner_id: owner.id,
        count: bids.length,
        bids,
      },
    })
  })
}
