# Launch-day end-to-end check (Windows PowerShell 5.1+ or PowerShell 7).
#   .\scripts\verify-launch-demo.ps1              build, then run every check against two fresh local nodes
#   .\scripts\verify-launch-demo.ps1 -SkipBuild   reuse the existing build
#   .\scripts\verify-launch-demo.ps1 -Published   also verify with the live npm CLI (npx -y @bloom-exchange/sdk@0.1.0)
# Exits 0 only if every check passes. See scripts/launch-demo.ts for what is checked.
param([switch]$SkipBuild, [switch]$Published)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$v = (node -p "process.versions.node").Trim()
$p = $v.Split(".") | ForEach-Object { [int]$_ }
if ($p[0] -lt 22 -or ($p[0] -eq 22 -and $p[1] -lt 18)) {
  Write-Host "  x Node $v found; the repository scripts need Node 22.18 or newer (TypeScript type stripping). The published packages run on Node 20+." -ForegroundColor Red
  exit 2
}
if (-not (Test-Path "node_modules")) { npm install; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
if (-not $SkipBuild) {
  Write-Host "  building packages and the node (npm run build)..."
  npm run build *> $null
  if ($LASTEXITCODE -ne 0) { Write-Host "  x npm run build failed; run it directly to see the error." -ForegroundColor Red; exit $LASTEXITCODE }
}
$demoArgs = @("--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/launch-demo.ts")
if ($Published) { $demoArgs += "--published" }
node @demoArgs
exit $LASTEXITCODE
