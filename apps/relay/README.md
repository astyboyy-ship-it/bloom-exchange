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
| `VERIFIER_URL` | Where receipts verify in a browser (default `https://bloom-exchange-verify.vercel.app`) |
| `PORT`, `HOST` | Default `8787` and `127.0.0.1`; `0.0.0.0` in production |
| `RELAY_STREAM_MS` | How long one SSE stream stays open before the client reconnects (default 100 s; 50 s on Vercel) |
| `DATABASE_POOL_MAX` | Postgres connections per instance (default 10; 2 on Vercel, where every instance opens its own pool) |

With `NODE_ENV=production`, the relay refuses to start without Postgres and Redis. See [`.env.example`](.env.example).

### Where it runs

| Host | Entry | Live streams |
|---|---|---|
| **Vercel** (default: `https://bloom-exchange-relay.vercel.app`) | [`vercel.json`](vercel.json): one Node.js function, [`api/index.js`](api/index.js) → `src/vercel.ts` | SSE and polling. Vercel functions can't accept WebSocket upgrades, so `/health` reports `transports: ["sse","poll"]` and the SDK falls back to SSE within two attempts. Each SSE stream reads the shared store about once a second, so a move made in another invocation still arrives. Streams end before the function limit and the SDK reconnects from its last event. |
| **Fly, Docker or any server** | [`Dockerfile`](Dockerfile), [`fly.toml`](fly.toml), `src/main.ts` | WebSocket, SSE and polling |

On Vercel, use Supabase's **pooler** for `DATABASE_URL`, because every instance opens its own small pool. `api/index.js` loads the compiled relay (`dist/`), which `vercel.json` builds from the repository root.

## Launch runbook (Vercel)

`scripts/phase2-launch.sh` wraps each step, prints the exact command before running it, and runs nothing unless you name a step. Run it from Git Bash on Windows.

**Keep secrets out of the repository.** Store them in `~/.bloom-phase2.env` and Supabase's CA certificate in `~/.bloom-prod-ca-2021.crt`, then load them without printing anything. The `check` step flags any secret-looking file inside the repository.

```bash
# ~/.bloom-phase2.env  (outside the repository)
export SUPABASE_DB_URL='postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres'           # direct, for the migration
export DATABASE_URL='postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres'   # pooler; no sslmode=
export DATABASE_SSL_CA_FILE=~/.bloom-prod-ca-2021.crt
export UPSTASH_REDIS_REST_URL='https://<id>.upstash.io'
export UPSTASH_REDIS_REST_TOKEN='<token>'
```

```bash
set -a; . ~/.bloom-phase2.env; set +a
./scripts/phase2-launch.sh check             # tools, logins, targets, variables (values never printed)
./scripts/phase2-launch.sh migrate           # psql (verify-full) if installed, else scripts/phase2-migrate.ts: one transaction, refuses a second run
./scripts/phase2-launch.sh vercel-link       # link apps/relay -> bloom-exchange-relay, apps/verifier -> bloom-exchange-verify; checks Root Directory
./scripts/phase2-launch.sh relay-env         # vercel env add … --sensitive, values from stdin: DB, CA, Upstash, RELAY_PUBLIC_URL, VERIFIER_URL
./scripts/phase2-launch.sh deploy-relay      # vercel deploy --prod from the repository root, then GET /health
./scripts/phase2-launch.sh deploy-verifier   # vercel deploy --prod --build-env NEXT_PUBLIC_BLOOM_RELAY_URL=<relay>
./scripts/phase2-launch.sh smoke             # npm run smoke:phase2 -- --live against both live URLs
```

* **Each Vercel project needs its Root Directory set:** `apps/relay` and `apps/verifier`. Deploys upload the repository root, and `.vercelignore` keeps `node_modules`, builds, `.env` files and certificates out. `vercel-link` reports any project whose Root Directory isn't set.
* **Project URLs.** A Vercel project gets `https://<project>.vercel.app` when that name is free. If Vercel assigned different URLs, set `RELAY_URL` and `VERIFIER_URL` before `relay-env`, `deploy-verifier` and `smoke`. No DNS is needed for `*.vercel.app`.
* **Receipts carry the relay's origin.** Every receipt permanently records `RELAY_PUBLIC_URL`. A custom domain added later still leaves the `*.vercel.app` address serving, so earlier receipts keep resolving.
* **Supabase TLS.** Supabase signs its Postgres certificates with its own CA, so the relay needs `DATABASE_SSL_CA`. Without it the relay can't verify the connection; certificate verification is never switched off.
* **Fly instead of Vercel** (with WebSocket streams): `relay-secrets-fly`, then `deploy-relay-fly`, using [`fly.toml`](fly.toml).
* **The smoke test leaves a permanent record.** The ledger is append-only and public, so each run against the live relay leaves one smoke-test receipt and two "Smoke test (disposable)" agents. It also checks that the live relay reports `postgres` and `redis`, not the memory fallbacks.
* **Reference liquidity, optional.** `BLOOM_RELAY_URL=https://bloom-exchange-relay.vercel.app npm run seed:sellers -- --live` runs labeled demo sellers that deliver nothing. Leave them off a public launch unless the landing copy says so.

### v1 launch limits

* **WebSocket fan-out is per process.** SSE and polling work across any number of instances, including serverless invocations, because they read the shared store. WebSocket streams, which exist only on a long-running server, still push only moves made through the same process, so run one instance if you rely on WebSocket.
* **No rate limiting.** Any key can call any endpoint as fast as it likes. Put Vercel's firewall rules, Fly's proxy limits or a WAF in front before a wide announcement.
* **No revocation endpoint.** The `revoked` column exists and reputation counts it as a dispute, but only a database operator can set it.
* **Domains and orgs are claimed, not verified.** `domainVerified` is always false, and the verifier says "claimed".
* **Unsigned tree heads.** An inclusion proof binds a receipt to the root the relay reports. A relay showing different readers different roots would not yet be caught.
* **Full-ledger Merkle recomputation.** Each clear and each proof request recomputes the tree over every receipt: fine for thousands of receipts, not millions.
* **Public receipts.** A cleared receipt is a public verification payload, terms and price included. Rooms and offers stay private to their parties.

## Tested, and not yet

**Tested:**
- The memory store, end to end over real HTTP and WebSocket.
- The serverless shape: Vercel's Node adapter with no WebSocket server, two instances sharing one store (a move made through one reaches an SSE subscriber on the other), raw-target signature checks through the adapter, and the 503 a misconfigured function returns.
- The Postgres store and the migration, against real PostgreSQL through PGlite: constraints, append-only triggers, GIN and partial indexes, and byte-exact transcript round-trips.

**Not tested here:**
- A live Supabase or managed Postgres instance, or Upstash itself (its REST call is tested against a fake).
- The real Vercel and Fly deployments, and the Docker image. Vercel's rewrite is expected to pass the original path and query through to the function, and the relay's signature checks depend on it; the live smoke test is what confirms that. The launch script has been syntax-checked and dry-run, and its migrator tested against PostgreSQL. The smoke test (`npm run smoke:phase2`) passes against a local relay.
- Real concurrency on Postgres: PGlite runs one session, so the tests use one connection. Row locks and the advisory ledger lock are written for multiple instances but aren't exercised under contention.

**Not built yet:**
- **Signed tree heads.** An inclusion proof binds a receipt to the root the relay reports, not to a root the relay can't change.
- **Domain verification.** `domain` and `org` are claimed only, and `domainVerified` is always false.
- **Cross-instance live fan-out.** Run one instance until fan-out moves to Redis pub/sub. State, the ledger and replay protection are already shared.
- **Rate limiting and receipt revocation endpoints.** The `revoked` column exists, and reputation counts it.
- **Ledger performance.** The Merkle root is recomputed over every receipt on each clear and each proof request: fine for thousands of receipts, not for millions.
