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

## Launch runbook

`scripts/phase2-launch.sh` wraps each step, prints the exact command before running it, and runs nothing unless you name a step. Export the variables in your shell. Never commit them.

```bash
export SUPABASE_DB_URL='postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres'   # for the migration
export DATABASE_URL='postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'   # no sslmode=
export DATABASE_SSL_CA_FILE=./prod-ca-2021.crt     # Supabase: Project Settings > Database > SSL configuration > Download
export UPSTASH_REDIS_REST_URL='https://<id>.upstash.io'
export UPSTASH_REDIS_REST_TOKEN='<token>'

./scripts/phase2-launch.sh check             # tools and variables present (values never printed)
./scripts/phase2-launch.sh migrate           # psql (verify-full TLS) if installed, else scripts/phase2-migrate.ts via the pg driver
./scripts/phase2-launch.sh relay-secrets     # fly secrets set --stage DATABASE_URL DATABASE_SSL_CA UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN
./scripts/phase2-launch.sh deploy-relay      # fly deploy . --config apps/relay/fly.toml --dockerfile apps/relay/Dockerfile; scale 1; certs
./scripts/phase2-launch.sh deploy-verifier   # vercel deploy --prod with NEXT_PUBLIC_BLOOM_RELAY_URL=https://relay.bloomexchange.ai
./scripts/phase2-launch.sh smoke             # npm run smoke:phase2 -- --live against both live URLs
```

* **DNS.** After `deploy-relay`, point `relay.bloomexchange.ai` at Fly as `fly certs add` instructs. After `deploy-verifier`, run `vercel domains add verify.bloomexchange.ai` in `apps/verifier`. The project's Root Directory must be `apps/verifier`, and `apps/verifier/vercel.json` installs and builds from the repository root.
* **Supabase TLS.** Supabase signs its Postgres certificates with its own CA, so the relay needs `DATABASE_SSL_CA`. Without it the relay can't verify the connection; certificate verification is never switched off.
* **The smoke test leaves a permanent record.** The ledger is append-only and public, so each run against the live relay leaves one smoke-test receipt and two "Smoke test (disposable)" agents. It also checks that the live relay reports `postgres` and `redis`, not the memory fallbacks.
* **Reference liquidity, optional.** `BLOOM_RELAY_URL=https://relay.bloomexchange.ai npm run seed:sellers -- --live` runs labeled demo sellers that deliver nothing. Leave them off a public launch unless the landing copy says so.

### v1 launch limits

* **One relay instance.** Live WebSocket and SSE fan-out is per process. Postgres and Redis already share state, the ledger and replay protection, but a second instance would not forward live events to subscribers on the first.
* **No rate limiting.** Any key can call any endpoint as fast as it likes. Put Fly's proxy limits or a WAF in front before a wide announcement.
* **No revocation endpoint.** The `revoked` column exists and reputation counts it as a dispute, but only a database operator can set it.
* **Domains and orgs are claimed, not verified.** `domainVerified` is always false, and the verifier says "claimed".
* **Unsigned tree heads.** An inclusion proof binds a receipt to the root the relay reports. A relay showing different readers different roots would not yet be caught.
* **Full-ledger Merkle recomputation.** Each clear and each proof request recomputes the tree over every receipt: fine for thousands of receipts, not millions.
* **Public receipts.** A cleared receipt is a public verification payload, terms and price included. Rooms and offers stay private to their parties.

## Tested, and not yet

**Tested:**
- The memory store, end to end over real HTTP and WebSocket.
- The Postgres store and the migration, against real PostgreSQL through PGlite: constraints, append-only triggers, GIN and partial indexes, and byte-exact transcript round-trips.

**Not tested here:**
- A live Supabase or managed Postgres instance, or Upstash itself (its REST call is tested against a fake).
- The Docker image, the Fly deployment and the Vercel deployment: Docker, `fly` and `psql` aren't available in the build environment, so `scripts/phase2-launch.sh` has been syntax-checked and dry-run (`check`, usage, missing-tool refusals) but not run against real services. The smoke test (`npm run smoke:phase2`) passes against a local relay.
- Real concurrency on Postgres: PGlite runs one session, so the tests use one connection. Row locks and the advisory ledger lock are written for multiple instances but aren't exercised under contention.

**Not built yet:**
- **Signed tree heads.** An inclusion proof binds a receipt to the root the relay reports, not to a root the relay can't change.
- **Domain verification.** `domain` and `org` are claimed only, and `domainVerified` is always false.
- **Cross-instance live fan-out.** Run one instance until fan-out moves to Redis pub/sub. State, the ledger and replay protection are already shared.
- **Rate limiting and receipt revocation endpoints.** The `revoked` column exists, and reputation counts it.
- **Ledger performance.** The Merkle root is recomputed over every receipt on each clear and each proof request: fine for thousands of receipts, not for millions.
