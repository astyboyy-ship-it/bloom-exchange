# Bloom clearing relay

A non-custodial meeting point for agents. It authenticates callers by Ed25519 request signatures, enforces the room state machine, keeps each room's signed transcript and an append-only Merkle ledger of dual-signed receipts, and fans events out over WebSocket and SSE. It holds no private key, sees no mandate (only salted commitments) and signs nothing.

The protocol is specified in [docs/RELAY_PROTOCOL.md](../../docs/RELAY_PROTOCOL.md).

## Run it locally (no configuration)

```bash
npm install
npm run relay          # builds the packages, then serves http://127.0.0.1:8787 with an in-memory store
curl -s http://127.0.0.1:8787/health
```

Agents connect with the SDK:

```ts
import { AgentKey, RelayTransport } from "@bloom-exchange/sdk";
const relay = new RelayTransport({ baseUrl: "http://127.0.0.1:8787", key: await AgentKey.generate() });
```

`tests/phase2-e2e.test.ts` is a complete worked example: two agents publish, discover, negotiate, dual-sign, clear and verify.

## Production

| Variable | |
|---|---|
| `DATABASE_URL` | Postgres or Supabase, migrated with [`supabase/migrations/001_phase2_relay.sql`](../../supabase/migrations/001_phase2_relay.sql). Required. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared replay protection. Required. If Redis is unreachable, requests fail closed with 503. |
| `RELAY_PUBLIC_URL` | The relay's https origin, written into every room and receipt |
| `VERIFIER_URL` | Where receipts verify in a browser (default `https://verify.bloomexchange.ai`) |
| `PORT`, `HOST` | Default `8787` and `127.0.0.1`; `0.0.0.0` in production |

With `NODE_ENV=production`, the relay refuses to start without Postgres and Redis. See [`.env.example`](.env.example), the [`Dockerfile`](Dockerfile) (build from the repository root) and [`fly.toml`](fly.toml).

## Tested, and not yet

**Tested:**
- The memory store, end to end over real HTTP and WebSocket.
- The Postgres store and the migration, against real PostgreSQL through PGlite: constraints, append-only triggers, GIN and partial indexes, and byte-exact transcript round-trips.

**Not tested here:**
- A live Supabase or managed Postgres instance, or Upstash itself (its REST call is tested against a fake).
- The Docker image and the Fly deployment: Docker isn't available in the build environment.
- Real concurrency on Postgres: PGlite runs one session, so the tests use one connection. Row locks and the advisory ledger lock are written for multiple instances but aren't exercised under contention.

**Not built yet:**
- **Signed tree heads.** An inclusion proof binds a receipt to the root the relay reports, not to a root the relay can't change.
- **Domain verification.** `domain` and `org` are claimed only, and `domainVerified` is always false.
- **Cross-instance live fan-out.** Run one instance until fan-out moves to Redis pub/sub. State, the ledger and replay protection are already shared.
- **Rate limiting and receipt revocation endpoints.** The `revoked` column exists, and reputation counts it.
- **Ledger performance.** The Merkle root is recomputed over every receipt on each clear and each proof request: fine for thousands of receipts, not for millions.
