#!/usr/bin/env bash
# Phase 2 launch runbook: Supabase migration, Fly.io relay, Vercel verifier, live smoke test.
# Runs nothing unless you name a step. Each step prints the exact command before it runs it.
#
#   ./scripts/phase2-launch.sh check            tools and environment variables present? (changes nothing)
#   ./scripts/phase2-launch.sh migrate          apply supabase/migrations/001_phase2_relay.sql   (needs SUPABASE_DB_URL)
#   ./scripts/phase2-launch.sh relay-secrets    set the relay's production secrets on Fly         (needs the variables below)
#   ./scripts/phase2-launch.sh deploy-relay     build and deploy apps/relay to Fly, one machine, TLS for relay.bloomexchange.ai
#   ./scripts/phase2-launch.sh deploy-verifier  deploy apps/verifier to Vercel production with the relay URL baked in
#   ./scripts/phase2-launch.sh smoke            post-deploy smoke test (leaves one permanent, labeled receipt)
#
# Environment (never committed; export in your shell or use a secrets manager):
#   SUPABASE_DB_URL           postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres   (for migrate)
#   DATABASE_URL              the URL the relay uses (Supabase pooler or direct; no sslmode= parameter)
#   DATABASE_SSL_CA_FILE      Supabase's CA certificate (Project Settings > Database > SSL configuration)
#   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
#   FLY_APP (default bloom-relay)  RELAY_HOST (default relay.bloomexchange.ai)  VERIFIER_HOST (default verify.bloomexchange.ai)
set -euo pipefail
cd "$(dirname "$0")/.."

FLY_APP="${FLY_APP:-bloom-relay}"
RELAY_HOST="${RELAY_HOST:-relay.bloomexchange.ai}"
VERIFIER_HOST="${VERIFIER_HOST:-verify.bloomexchange.ai}"
MIGRATION="supabase/migrations/001_phase2_relay.sql"

say() { printf '\n  \033[1m%s\033[0m\n' "$*"; }
run() { printf '  $ %s\n' "$*"; "$@"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "  x $1 is not installed ($2)"; exit 1; }; }
needvar() { [ -n "${!1:-}" ] || { echo "  x $1 is not set"; exit 1; }; }
# Fly's CLI is `fly` from the Linux/macOS installer and `flyctl` from winget or scoop; FLY_BIN overrides both.
FLY="${FLY_BIN:-$(command -v fly || command -v flyctl || true)}"
needfly() { [ -n "$FLY" ] || { echo "  x flyctl is not installed (https://fly.io/docs/flyctl/install/ · Windows: winget install Fly-io.flyctl)"; exit 1; }; }

case "${1:-}" in
  check)
    say "Tools"
    for t in node npm vercel; do
      if command -v "$t" >/dev/null 2>&1; then echo "  ✓ $t"; else echo "  - $t missing"; fi
    done
    if [ -n "$FLY" ]; then echo "  ✓ flyctl ($FLY)"; "$FLY" auth whoami >/dev/null 2>&1 && echo "  ✓ logged in to Fly" || echo "  - not logged in to Fly: run '$(basename "$FLY") auth login'"; else echo "  - flyctl missing"; fi
    if command -v psql >/dev/null 2>&1; then echo "  ✓ psql"; else echo "  - psql missing: migrate uses scripts/phase2-migrate.ts (the pg driver) instead"; fi
    vercel whoami >/dev/null 2>&1 && echo "  ✓ logged in to Vercel" || echo "  - not logged in to Vercel: run 'vercel login'"
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' && echo "  ✓ node >= 22.18" || echo "  x node must be >= 22.18"
    say "Environment (values not shown)"
    for v in SUPABASE_DB_URL DATABASE_URL DATABASE_SSL_CA_FILE UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN; do
      if [ -n "${!v:-}" ]; then echo "  ✓ $v"; else echo "  - $v unset"; fi
    done
    [ -n "${DATABASE_URL:-}" ] && case "$DATABASE_URL" in *sslmode=*) echo "  x DATABASE_URL contains sslmode=: remove it (the relay refuses to start)";; esac
    [ -n "${DATABASE_SSL_CA_FILE:-}" ] && { grep -q "BEGIN CERTIFICATE" "$DATABASE_SSL_CA_FILE" && echo "  ✓ CA file is a PEM certificate" || echo "  x $DATABASE_SSL_CA_FILE is not a PEM certificate"; }
    say "Repository"
    git diff --quiet && echo "  ✓ clean working tree ($(git rev-parse --short HEAD) on $(git branch --show-current))" || echo "  - uncommitted changes"
    ;;

  migrate)
    needvar SUPABASE_DB_URL
    say "Applying $MIGRATION (one transaction; fails on any error)"
    if command -v psql >/dev/null 2>&1; then
      export PGSSLMODE=verify-full
      [ -n "${DATABASE_SSL_CA_FILE:-}" ] && export PGSSLROOTCERT="$DATABASE_SSL_CA_FILE"
      run psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$MIGRATION"
      run psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('agents','intents','rooms','room_events','receipts') order by 1"
    else
      echo "  (no psql: using the relay's pg driver; TLS verified against DATABASE_SSL_CA_FILE)"
      run node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/phase2-migrate.ts
    fi
    ;;

  relay-secrets)
    needfly
    needvar DATABASE_URL; needvar DATABASE_SSL_CA_FILE; needvar UPSTASH_REDIS_REST_URL; needvar UPSTASH_REDIS_REST_TOKEN
    say "Setting secrets on $FLY_APP (values are read from your environment and not printed)"
    printf '  $ fly secrets set --app %s DATABASE_URL=*** DATABASE_SSL_CA=<%s> UPSTASH_REDIS_REST_URL=*** UPSTASH_REDIS_REST_TOKEN=***\n' "$FLY_APP" "$DATABASE_SSL_CA_FILE"
    "$FLY" secrets set --app "$FLY_APP" --stage \
      DATABASE_URL="$DATABASE_URL" \
      DATABASE_SSL_CA="$(cat "$DATABASE_SSL_CA_FILE")" \
      UPSTASH_REDIS_REST_URL="$UPSTASH_REDIS_REST_URL" \
      UPSTASH_REDIS_REST_TOKEN="$UPSTASH_REDIS_REST_TOKEN"
    echo "  ✓ staged; they apply on the next deploy"
    ;;

  deploy-relay)
    needfly
    say "Deploying apps/relay to Fly app $FLY_APP (build context: the repository root)"
    "$FLY" apps list | grep -q "^$FLY_APP\b" || run "$FLY" apps create "$FLY_APP"
    run "$FLY" deploy . --app "$FLY_APP" --config apps/relay/fly.toml --dockerfile apps/relay/Dockerfile --ha=false
    say "One machine: live fan-out is per process until it moves to Redis pub/sub"
    run "$FLY" scale count 1 --app "$FLY_APP" --yes
    say "TLS for $RELAY_HOST (then point DNS at Fly as the output says)"
    run "$FLY" certs add "$RELAY_HOST" --app "$FLY_APP" || true
    run curl -fsS "https://$FLY_APP.fly.dev/health"
    echo
    ;;

  deploy-verifier)
    need vercel "npm i -g vercel"
    say "Deploying apps/verifier to Vercel production, NEXT_PUBLIC_BLOOM_RELAY_URL=https://$RELAY_HOST"
    echo "  (first time: run 'vercel link' in apps/verifier, and set the project's Root Directory to apps/verifier)"
    (cd apps/verifier && run vercel deploy --prod --build-env NEXT_PUBLIC_BLOOM_RELAY_URL="https://$RELAY_HOST" --env NEXT_PUBLIC_BLOOM_RELAY_URL="https://$RELAY_HOST")
    echo "  Then add the domain: vercel domains add $VERIFIER_HOST (in apps/verifier)"
    ;;

  smoke)
    say "Smoke test against https://$RELAY_HOST and https://$VERIFIER_HOST (leaves one permanent, labeled receipt)"
    BLOOM_RELAY_URL="https://$RELAY_HOST" BLOOM_VERIFIER_URL="https://$VERIFIER_HOST" run npm run smoke:phase2 -- --live
    ;;

  *)
    sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
