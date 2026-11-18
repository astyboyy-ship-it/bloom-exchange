#!/usr/bin/env sh
# Launch-day end-to-end check (macOS, Linux, Git Bash, WSL).
#   ./scripts/verify-launch-demo.sh               build, then run every check against two fresh local nodes
#   ./scripts/verify-launch-demo.sh --skip-build  reuse the existing build
#   ./scripts/verify-launch-demo.sh --published   also verify with the live npm CLI (npx -y @bloom-exchange/sdk@0.1.0)
# Exits 0 only if every check passes. See scripts/launch-demo.ts for what is checked.
set -eu
cd "$(dirname "$0")/.."

skip_build=0
demo_flags=""
for arg in "$@"; do
  case "$arg" in
    --skip-build) skip_build=1 ;;
    --published) demo_flags="--published" ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  echo "  x Node $(node -v) found; the repository scripts need Node 22.18 or newer (TypeScript type stripping). The published packages run on Node 20+." >&2
  exit 2
fi
[ -d node_modules ] || npm install
if [ "$skip_build" -eq 0 ]; then
  echo "  building packages and the node (npm run build)..."
  npm run build >/dev/null 2>&1 || { echo "  x npm run build failed; run it directly to see the error." >&2; exit 1; }
fi
# shellcheck disable=SC2086
exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/launch-demo.ts $demo_flags
