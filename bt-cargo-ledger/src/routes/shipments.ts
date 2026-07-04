import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { hashCheckpoint, computeMerkleRoot } from '../lib/merkle.js'
import { writeHashToChain } from '../lib/blockchain.js'

const CreateShipmentBody = z.object({
  booking_id: z.string().uuid(),
  origin_address: z.string(),
  destination_address: z.string(),
  cargo_description: z.string(),
  total_weight_kg: z.number().positive(),
  total_pieces: z.number().int().positive(),
  legs: z.array(z.object({
    sequence: z.number().int(),
    from_address: z.string(),
    to_address: z.string(),
    assigned_driver_id: z.string().uuid().optional(),
  })).min(1),
})

const CheckpointBody = z.object({
  shipment_id: z.string().uuid(),
  leg_id: z.string().uuid(),
  checkpoint_type: z.enum(['pickup', 'handoff', 'waypoint', 'delivery']),
  lat: z.number(),
  lng: z.number(),
  address: z.string(),
  pieces_count: z.number().int(),
  weight_kg: z.number(),
  notes: z.string().optional(),
  photo_urls: z.array(z.string()).optional(),
  outgoing_driver_id: z.string().uuid().optional(),
  incoming_party_id: z.string().uuid().optional(),
})

export async function shipmentRoutes(app: FastifyInstance) {

  /**
   * POST /shipments
   * Create a new multi-leg shipment for a booking.
   */
  app.post('/', async (req, reply) => {
    const body = CreateShipmentBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.errors[0].message })

    // TODO: insert shipment + legs into Supabase
    const shipment_id = crypto.randomUUID()

    return reply.status(201).send({
      success: true,
      data: {
        shipment_id,
        booking_id: body.data.booking_id,
        legs: body.data.legs.length,
        status: 'created',
      },
    })
  })

  /**
   * POST /shipments/checkpoint
   * Record a handshake at a checkpoint.
   * Computes SHA-256 hash of the checkpoint data.
   * On final delivery, computes Merkle root + writes to blockchain.
   */
  app.post('/checkpoint', async (req, reply) => {
    const body = CheckpointBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.errors[0].message })

    const signed_at = new Date().toISOString()
    const { shipment_id, leg_id, checkpoint_type, lat, lng, address,
            pieces_count, weight_kg, outgoing_driver_id, incoming_party_id } = body.data

    // Compute checkpoint hash
    const merkle_hash = hashCheckpoint({
      shipment_id, leg_id, checkpoint_type, lat, lng,
      address, pieces_count, weight_kg, signed_at,
      outgoing_driver_id: outgoing_driver_id ?? null,
      incoming_party_id: incoming_party_id ?? null,
    })

    // TODO: save checkpoint to Supabase with merkle_hash

    app.log.info({ shipment_id, checkpoint_type, merkle_hash }, 'Checkpoint recorded')

    let blockchain_tx_hash: string | null = null

    // On final delivery: compute Merkle root of all checkpoints and write to chain
    if (checkpoint_type === 'delivery') {
      // TODO: fetch all checkpoint hashes for this shipment from Supabase
      const allHashes = [merkle_hash]  // stub — real query goes here
      const merkle_root = computeMerkleRoot(allHashes)

      const chainResult = await writeHashToChain(shipment_id, merkle_root)
      blockchain_tx_hash = chainResult.tx_hash

      app.log.info({ shipment_id, merkle_root, tx_hash: blockchain_tx_hash }, 'Shipment proof finalized')
    }

    return reply.status(201).send({
      success: true,
      data: {
        checkpoint_type,
        merkle_hash,
        blockchain_tx_hash,
        signed_at,
      },
    })
  })

  /**
   * GET /shipments/:id/proof
   * Returns full chain of custody for a shipment — verifiable by anyone.
   */
  app.get('/:id/proof', async (req, reply) => {
    const { id } = req.params as { id: string }
    // TODO: fetch all checkpoints from Supabase, recompute Merkle root, compare to on-chain

    return reply.send({
      success: true,
      data: {
        shipment_id: id,
        is_complete: false,
        root_hash: null,
        blockchain_tx_hash: null,
        checkpoints: [],
        note: 'Full proof generation — Sprint 5',
      },
    })
  })

  /**
   * GET /shipments/:id
   * Current status of a shipment with all legs.
   */
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    // TODO: fetch from Supabase
    return reply.send({ success: true, data: { shipment_id: id, status: 'stub' } })
  })
}
