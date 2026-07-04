/**
 * Blockchain writer — Polygon (Matic)
 *
 * Phase 1: BLOCKCHAIN_ENABLED=false
 *   → Merkle root computed and stored in DB only
 *   → No on-chain write, no wallet needed
 *
 * Phase 2: BLOCKCHAIN_ENABLED=true
 *   → Root hash written to Polygon via a simple smart contract call
 *   → ethers.js integration goes here
 */

const ENABLED = process.env.BLOCKCHAIN_ENABLED === 'true'

export interface ChainWriteResult {
  tx_hash: string | null
  block_number: number | null
  written_at: string
}

export async function writeHashToChain(
  shipment_id: string,
  merkle_root: string
): Promise<ChainWriteResult> {
  if (!ENABLED) {
    // Phase 1: log only, no on-chain write
    console.log(`[LEDGER] Merkle root for ${shipment_id}: ${merkle_root} (blockchain write disabled)`)
    return { tx_hash: null, block_number: null, written_at: new Date().toISOString() }
  }

  // Phase 2: ethers.js call goes here
  // const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL)
  // const wallet = new ethers.Wallet(process.env.LEDGER_WALLET_PRIVATE_KEY!, provider)
  // const contract = new ethers.Contract(process.env.LEDGER_CONTRACT_ADDRESS!, ABI, wallet)
  // const tx = await contract.recordShipment(shipment_id, merkle_root)
  // const receipt = await tx.wait()
  // return { tx_hash: receipt.hash, block_number: receipt.blockNumber, written_at: new Date().toISOString() }

  throw new Error('Blockchain write not yet implemented — set BLOCKCHAIN_ENABLED=false')
}
