# Runs backtest variants one change at a time and collects the results.
# Each variant differs from the baseline in exactly ONE dimension, so any
# improvement can be attributed instead of guessed at.

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$variants = @(
  @{ name = "baseline";      args = "" },
  @{ name = "exit-buffer-50"; args = "--exit-rank 50" },
  @{ name = "hold-40";        args = "--top 40" },
  @{ name = "sector-cap-4";   args = "--max-sector 4" },
  @{ name = "all-three";      args = "--top 40 --exit-rank 50 --max-sector 4" }
)

$out = @()
foreach ($v in $variants) {
  Write-Host "=== $($v.name) ==="
  # SEC throttles for minutes after heavy use. One variant failing that way
  # should not take the whole sweep down with it.
  $attempt = 0
  do {
    $attempt++
    if ($attempt -gt 1) {
      Write-Host "  retry $attempt after SEC backoff..."
      Start-Sleep -Seconds 300
    }
    cmd /c "npm run backtest -- $($v.args) > variant-$($v.name).log 2>&1"
  } while ($LASTEXITCODE -ne 0 -and $attempt -lt 3)

  if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED after $attempt attempts (exit $LASTEXITCODE)"
    Get-Content "variant-$($v.name).log" -Tail 3
    continue
  }
  $j = Get-Content "data\backtest.json" -Raw | ConvertFrom-Json
  Copy-Item "data\backtest.json" "variant-$($v.name).json" -Force
  $row = [pscustomobject]@{
    variant   = $v.name
    cagr      = $j.stats.cagr
    bench     = $j.stats.benchCagr
    excess    = [math]::Round($j.stats.cagr - $j.stats.benchCagr, 2)
    sharpe    = $j.stats.sharpe
    maxDD     = $j.stats.maxDrawdown
    turnover  = $j.stats.avgTurnoverPct
    costDrag  = $j.stats.costDragAnnualPct
    h1        = if ($j.subPeriods) { $j.subPeriods[0].excess } else { $null }
    h2        = if ($j.subPeriods) { $j.subPeriods[1].excess } else { $null }
  }
  $out += $row
  $row | Format-Table | Out-String | Write-Host
}

$out | ConvertTo-Json -Depth 3 | Set-Content "variant-results.json" -Encoding utf8
Write-Host ""
Write-Host "=== ALL VARIANTS ==="
$out | Format-Table -AutoSize | Out-String | Write-Host
