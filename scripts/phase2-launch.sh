#!/usr/bin/env bash
# Phase 2 launch runbook: Supabase migration, relay and verifier on Vercel (*.vercel.app), live smoke test.
# Runs nothing unless you name a step. Each step prints the exact command before it runs it; secret values are
# never printed or passed on a command line (Vercel reads them from stdin).
#
#   ./scripts/phase2-launch.sh check            tools, logins and variables present? (changes nothing)
#   ./scripts/phase2-launch.sh migrate          apply supabase/migrations/001_phase2_relay.sql   (needs SUPABASE_DB_URL)
#   ./scripts/phase2-launch.sh vercel-link      create/link the two Vercel projects (apps/relay, apps/verifier)
#   ./scripts/phase2-launch.sh relay-env        set the relay project's production variables on Vercel
#   ./scripts/phase2-launch.sh deploy-relay     deploy apps/relay to Vercel production, then check /health
#   ./scripts/phase2-launch.sh deploy-verifier  deploy apps/verifier with the live relay URL baked in
#   ./scripts/phase2-launch.sh smoke            post-deploy smoke test (leaves one permanent, labeled receipt)
#   (Fly alternative for the relay, with WebSocket streams: relay-secrets-fly, deploy-relay-fly)
#
# Environment (never committed: keep it in ~/.bloom-phase2.env and load with  set -a; . ~/.bloom-phase2.env; set +a):
#   SUPABASE_DB_URL           direct connection, for migrate
#   DATABASE_URL              what the relay uses; for Vercel, Supabase's pooler (no sslmode= parameter)
#   DATABASE_SSL_CA_FILE      Supabase's CA certificate, kept outside the repository (e.g. ~/.bloom-prod-ca-2021.crt)
#   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
#   RELAY_PROJECT (default bloom-exchange-relay)  VERIFIER_PROJECT (default bloom-exchange-verify)
#   RELAY_URL / VERIFIER_URL (default https://<project>.vercel.app; set them if Vercel assigned other URLs)
set -euo pipefail
cd "$(dirname "$0")/.."

RELAY_PROJECT="${RELAY_PROJECT:-bloom-exchange-relay}"
VERIFIER_PROJECT="${VERIFIER_PROJECT:-bloom-exchange-verify}"
RELAY_URL="${RELAY_URL:-https://$RELAY_PROJECT.vercel.app}"
VERIFIER_URL="${VERIFIER_URL:-https://$VERIFIER_PROJECT.vercel.app}"
FLY_APP="${FLY_APP:-bloom-relay}"
MIGRATION="supabase/migrations/001_phase2_relay.sql"

say() { printf '\n  \033[1m%s\033[0m\n' "$*"; }
run() { printf '  $ %s\n' "$*"; "$@"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "  x $1 is not installed ($2)"; exit 1; }; }
needvar() { [ -n "${!1:-}" ] || { echo "  x $1 is not set"; exit 1; }; }
# Fly's CLI is `fly` from the Linux/macOS installer and `flyctl` from winget or scoop; FLY_BIN overrides both.
FLY="${FLY_BIN:-$(command -v fly || command -v flyctl || true)}"
needfly() { [ -n "$FLY" ] || { echo "  x flyctl is not installed (https://fly.io/docs/flyctl/install/ · Windows: winget install Fly-io.flyctl)"; exit 1; }; }
# The org and project ids `vercel link` wrote for an app, so deploys can run from the repository root.
vercel_ids() {
  [ -f "$1/.vercel/project.json" ] || { echo "  x $1 is not linked: run ./scripts/phase2-launch.sh vercel-link"; exit 1; }
  node -e 'const p=require(process.argv[1]);console.log(p.orgId+" "+p.projectId)' "$(pwd)/$1/.vercel/project.json"
}
# Sets one production variable on the project linked in $1, reading the value from stdin (never argv or output).
vercel_env() {
  printf '  $ vercel env add %s production --force --sensitive --cwd %s   (value from stdin, not shown)\n' "$2" "$1"
  vercel env add "$2" production --force --sensitive --cwd "$1" >/dev/null
}

case "${1:-}" in
  check)
    say "Tools"
    for t in node npm vercel; do
      if command -v "$t" >/dev/null 2>&1; then echo "  ✓ $t"; else echo "  - $t missing"; fi
    done
    vercel whoami >/dev/null 2>&1 && echo "  ✓ logged in to Vercel" || echo "  - not logged in to Vercel: run 'vercel login'"
    if command -v psql >/dev/null 2>&1; then echo "  ✓ psql"; else echo "  - psql missing: migrate uses scripts/phase2-migrate.ts (the pg driver) instead"; fi
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' && echo "  ✓ node >= 22.18" || echo "  x node must be >= 22.18"
    say "Targets"
    echo "  relay    $RELAY_URL  (Vercel project $RELAY_PROJECT$([ -f apps/relay/.vercel/project.json ] && echo ', linked' || echo ', not linked yet'))"
    echo "  verifier $VERIFIER_URL  (Vercel project $VERIFIER_PROJECT$([ -f apps/verifier/.vercel/project.json ] && echo ', linked' || echo ', not linked yet'))"
    say "Environment (values not shown)"
    for v in SUPABASE_DB_URL DATABASE_URL DATABASE_SSL_CA_FILE UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN; do
      if [ -n "${!v:-}" ]; then echo "  ✓ $v"; else echo "  - $v unset"; fi
    done
    if [ -n "${DATABASE_URL:-}" ]; then case "$DATABASE_URL" in *sslmode=*) echo "  x DATABASE_URL contains sslmode=: remove it (the relay refuses to start)";; esac; fi
    if [ -n "${DATABASE_SSL_CA_FILE:-}" ]; then
      case "$(cd "$(dirname "$DATABASE_SSL_CA_FILE")" 2>/dev/null && pwd)/" in "$(pwd)/"*) echo "  x the CA file is inside the repository: move it out (e.g. ~/.bloom-prod-ca-2021.crt)";; esac
      grep -q "BEGIN CERTIFICATE" "$DATABASE_SSL_CA_FILE" 2>/dev/null && echo "  ✓ CA file is a PEM certificate" || echo "  x $DATABASE_SSL_CA_FILE is not a readable PEM certificate"
    fi
    say "Repository"
    git diff --quiet && git diff --cached --quiet && echo "  ✓ clean working tree ($(git rev-parse --short HEAD) on $(git branch --show-current))" || echo "  - uncommitted changes"
    git ls-files --others --cached --exclude-standard | grep -E '\.env$|\.crt$|\.pem$|bloom-phase2' && echo "  x secret-looking files are inside the repository" || echo "  ✓ no secret-looking files in the repository"
    ;;

  migrate)
    needvar SUPABASE_DB_URL
    say "Applying $MIGRATION (one transaction; fails on any error)"
    if command -v psql >/dev/null 2>&1; then
      export PGSSLMODE=verify-full
      if [ -n "${DATABASE_SSL_CA_FILE:-}" ]; then export PGSSLROOTCERT="$DATABASE_SSL_CA_FILE"; fi
      run psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$MIGRATION"
      run psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('agents','intents','rooms','room_events','receipts') order by 1"
    else
      echo "  (no psql: using the relay's pg driver; TLS verified against DATABASE_SSL_CA_FILE)"
      run node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/phase2-migrate.ts
    fi
    ;;

  vercel-link)
    need vercel "npm i -g vercel"
    say "Linking apps/relay to Vercel project $RELAY_PROJECT and apps/verifier to $VERIFIER_PROJECT"
    run vercel link --yes --project "$RELAY_PROJECT" --cwd apps/relay
    run vercel link --yes --project "$VERIFIER_PROJECT" --cwd apps/verifier
    say "Root Directory (deploys upload the repository root, so each project must build its own app)"
    for p in "$RELAY_PROJECT:apps/relay" "$VERIFIER_PROJECT:apps/verifier"; do
      name="${p%%:*}"; dir="${p#*:}"
      root="$(vercel project inspect "$name" 2>&1 | grep -i 'Root Directory' | sed 's/.*Root Directory[^A-Za-z.]*//' | tr -d '\r' || true)"
      if [ "$root" = "$dir" ]; then echo "  ✓ $name: Root Directory $dir"; else echo "  ! $name: Root Directory is '${root:-unset}'; set it to $dir in the dashboard (Settings > Build and Deployment > Root Directory)"; fi
    done
    ;;

  relay-env)
    need vercel "npm i -g vercel"
    needvar DATABASE_URL; needvar DATABASE_SSL_CA_FILE; needvar UPSTASH_REDIS_REST_URL; needvar UPSTASH_REDIS_REST_TOKEN
    vercel_ids apps/relay >/dev/null
    say "Setting the relay's production variables on $RELAY_PROJECT (values read from your environment, never shown)"
    printf '%s' "$DATABASE_URL" | vercel_env apps/relay DATABASE_URL
    vercel_env apps/relay DATABASE_SSL_CA < "$DATABASE_SSL_CA_FILE"
    printf '%s' "$UPSTASH_REDIS_REST_URL" | vercel_env apps/relay UPSTASH_REDIS_REST_URL
    printf '%s' "$UPSTASH_REDIS_REST_TOKEN" | vercel_env apps/relay UPSTASH_REDIS_REST_TOKEN
    printf '%s' "$RELAY_URL" | vercel_env apps/relay RELAY_PUBLIC_URL
    printf '%s' "$VERIFIER_URL" | vercel_env apps/relay VERIFIER_URL
    echo "  ✓ set; they apply on the next deploy"
    ;;

  deploy-relay)
    need vercel "npm i -g vercel"
    read -r ORG PROJECT < <(vercel_ids apps/relay)
    say "Deploying apps/relay to Vercel production ($RELAY_PROJECT), from the repository root"
    VERCEL_ORG_ID="$ORG" VERCEL_PROJECT_ID="$PROJECT" run vercel deploy --prod --yes
    say "Health of $RELAY_URL"
    run curl -fsS "$RELAY_URL/health"
    echo
    ;;

  deploy-verifier)
    need vercel "npm i -g vercel"
    read -r ORG PROJECT < <(vercel_ids apps/verifier)
    say "Deploying apps/verifier to Vercel production ($VERIFIER_PROJECT), NEXT_PUBLIC_BLOOM_RELAY_URL=$RELAY_URL"
    VERCEL_ORG_ID="$ORG" VERCEL_PROJECT_ID="$PROJECT" run vercel deploy --prod --yes --build-env NEXT_PUBLIC_BLOOM_RELAY_URL="$RELAY_URL"
    run curl -fsS -o /dev/null -w '  verifier answered HTTP %{http_code}\n' "$VERIFIER_URL/"
    ;;

  smoke)
    say "Smoke test against $RELAY_URL and $VERIFIER_URL (leaves one permanent, labeled receipt)"
    BLOOM_RELAY_URL="$RELAY_URL" BLOOM_VERIFIER_URL="$VERIFIER_URL" run npm run smoke:phase2 -- --live
    ;;

  relay-secrets-fly)
    needfly
    needvar DATABASE_URL; needvar DATABASE_SSL_CA_FILE; needvar UPSTASH_REDIS_REST_URL; needvar UPSTASH_REDIS_REST_TOKEN
    say "Setting secrets on Fly app $FLY_APP (values are read from your environment and not printed)"
    printf '  $ fly secrets set --app %s --stage DATABASE_URL=*** DATABASE_SSL_CA=<file> UPSTASH_REDIS_REST_URL=*** UPSTASH_REDIS_REST_TOKEN=***\n' "$FLY_APP"
    "$FLY" secrets set --app "$FLY_APP" --stage \
      DATABASE_URL="$DATABASE_URL" \
      DATABASE_SSL_CA="$(cat "$DATABASE_SSL_CA_FILE")" \
      UPSTASH_REDIS_REST_URL="$UPSTASH_REDIS_REST_URL" \
      UPSTASH_REDIS_REST_TOKEN="$UPSTASH_REDIS_REST_TOKEN" >/dev/null
    echo "  ✓ staged; they apply on the next deploy"
    ;;

  deploy-relay-fly)
    needfly
    say "Deploying apps/relay to Fly app $FLY_APP (build context: the repository root)"
    "$FLY" apps list | grep -q "^$FLY_APP\b" || run "$FLY" apps create "$FLY_APP"
    run "$FLY" deploy . --app "$FLY_APP" --config apps/relay/fly.toml --dockerfile apps/relay/Dockerfile --ha=false
    run "$FLY" scale count 1 --app "$FLY_APP" --yes
    run curl -fsS "https://$FLY_APP.fly.dev/health"
    echo
    ;;

  *)
    sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
