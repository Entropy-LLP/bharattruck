import { createHash } from 'crypto'

/**
 * Generates a deterministic SHA-256 hash for a checkpoint.
 * The hash is the source of truth — if anyone tampers with the DB record,
 * recomputing the hash will not match what's stored on-chain.
 */
export function hashCheckpoint(data: {
  shipment_id: string
  leg_id: string
  checkpoint_type: string
  lat: number
  lng: number
  address: string
  pieces_count: number
  weight_kg: number
  signed_at: string
  outgoing_driver_id?: string | null
  incoming_party_id?: string | null
}): string {
  const canonical = JSON.stringify(data, Object.keys(data).sort())
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Computes the Merkle root from an ordered list of checkpoint hashes.
 * Used to produce a single root hash for the entire shipment journey.
 * This root hash is what gets written to the Polygon blockchain.
 */
export function computeMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return ''
  if (hashes.length === 1) return hashes[0]

  let level = [...hashes]

  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = level[i + 1] ?? left  // odd node: duplicate last
      const combined = createHash('sha256').update(left + right).digest('hex')
      next.push(combined)
    }
    level = next
  }

  return level[0]
}
