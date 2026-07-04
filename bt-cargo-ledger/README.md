# bt-cargo-ledger

Tamper-evident chain-of-custody service for LogisticOS multi-leg shipments.

Each checkpoint (pickup, handoff, waypoint, delivery) is SHA-256 hashed and assembled into a Merkle tree. On final delivery the Merkle root is written to the **Polygon** blockchain, giving any party a verifiable, immutable proof of the shipment's full journey.

## How it works

```
Checkpoint recorded
      │
      ▼
SHA-256(canonicalized JSON)  →  merkle_hash  →  stored in Supabase
                                                         │
                                              (on delivery)
                                                         │
                                                         ▼
                                           computeMerkleRoot(all hashes)
                                                         │
                                                         ▼
                                           writeHashToChain()  →  Polygon tx
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `POST` | `/shipments` | Create a multi-leg shipment |
| `POST` | `/shipments/checkpoint` | Record a checkpoint handshake |
| `GET` | `/shipments/:id` | Get shipment status |
| `GET` | `/shipments/:id/proof` | Get full verifiable chain-of-custody proof |

## Blockchain phases

| `BLOCKCHAIN_ENABLED` | Behaviour |
|---|---|
| `false` (Phase 1) | Merkle root computed and stored in DB only — no wallet needed |
| `true` (Phase 2) | Root hash written on-chain via Polygon smart contract (ethers.js) |

## Getting started

```bash
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_ANON_KEY, etc.
npm install
npm run dev            # tsx watch on port 3005
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port (default `3005`) |
| `NODE_ENV` | No | `development` enables pino-pretty logs |
| `BLOCKCHAIN_ENABLED` | Yes | `false` (Phase 1) or `true` (Phase 2) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `POLYGON_RPC_URL` | Phase 2 | RPC endpoint for Polygon network |
| `LEDGER_WALLET_PRIVATE_KEY` | Phase 2 | Wallet that signs on-chain writes |
| `LEDGER_CONTRACT_ADDRESS` | Phase 2 | Deployed ledger smart contract address |

## Docker

```bash
# Development (hot-reload)
docker build --target development -t bt-cargo-ledger:dev .
docker run -p 3005:3005 --env-file .env bt-cargo-ledger:dev

# Production
docker build --target production -t bt-cargo-ledger:prod .
docker run -p 3005:3005 --env-file .env bt-cargo-ledger:prod
```

## Tech stack

- **Runtime**: Node 20, TypeScript, ESM
- **Framework**: Fastify 4
- **Validation**: Zod
- **Database**: Supabase (PostgreSQL)
- **Blockchain**: Polygon (Phase 2, ethers.js)
- **Hashing**: Node `crypto` — SHA-256 Merkle tree
