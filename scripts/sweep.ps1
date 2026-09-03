# Full pre-specified sweep: filters, holding periods, and the spec's six
# "potential enhancements". Every run is decided here, before any result is
# seen, and every run is reported -- including the losers. Picking the winner
# out of a dozen tries and presenting it alone is how a backtest talks itself
# into a number that will not repeat.

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# The published backtest is restored at the end; each run overwrites it.
$baseline = Join-Path $env:TEMP "sweep-baseline.json"
if (Test-Path "data\backtest.json") { Copy-Item "data\backtest.json" $baseline -Force }

$runs = @(
  # --- the model as specified, plus the penalty added this round
  @{ name = "baseline";          args = "" },
  @{ name = "no-red-flags";      args = "--no-red-flags" },

  # --- the six enhancements, one at a time so each is attributable
  @{ name = "sector-relative";   args = "--sector-relative" },
  @{ name = "volatility";        args = "--volatility" },
  @{ name = "piotroski-factor";  args = "--piotroski-factor" },
  @{ name = "shareholder-yield"; args = "--shareholder-yield" },
  @{ name = "zscore";            args = "--zscore" },
  @{ name = "enhanced-all";      args = "--enhanced" },

  # --- holding period, the only thing that has ever looked promising
  @{ name = "swing-2month";      args = "--rebalance 42" },
  @{ name = "swing-monthly";     args = "--rebalance 21" },

  # --- filters, re-measured on the corrected model
  @{ name = "filters-relaxed";   args = "--no-current-ratio --no-trend --exempt-financials" },

  # --- the two best ideas together, which is where overfitting usually hides
  @{ name = "enhanced-monthly";  args = "--enhanced --rebalance 21" }
)

$out = @()
foreach ($r in $runs) {
  Write-Host "=== $($r.name) ==="
  cmd /c "npm run backtest -- $($r.args) > sweep-$($r.name).log 2>&1"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED"; Get-Content "sweep-$($r.name).log" -Tail 5; continue
  }
  $j = Get-Content "data\backtest.json" -Raw | ConvertFrom-Json
  Copy-Item "data\backtest.json" "sweep-$($r.name).json" -Force
  $row = [pscustomobject]@{
    run      = $r.name
    cagr     = $j.stats.cagr
    bench    = $j.stats.benchCagr
    excess   = [math]::Round($j.stats.cagr - $j.stats.benchCagr, 2)
    sharpe   = $j.stats.sharpe
    maxDD    = $j.stats.maxDrawdown
    turnover = $j.stats.avgTurnoverPct
    costDrag = $j.stats.costDragAnnualPct
    pool     = $j.stats.avgInvestablePerRebalance
    h1       = if ($j.subPeriods) { $j.subPeriods[0].excess } else { $null }
    h2       = if ($j.subPeriods) { $j.subPeriods[1].excess } else { $null }
  }
  $out += $row
  $row | Format-List | Out-String | Write-Host
}

# ASCII, no BOM: PowerShell's utf8 writes one and it has broken four reads already.
[System.IO.File]::WriteAllText("$repo\sweep-results.json", ($out | ConvertTo-Json -Depth 3))

# Put the published backtest back. Whichever config wins is a decision to make
# on the numbers, not a side effect of whichever run happened to finish last.
if (Test-Path $baseline) { Copy-Item $baseline "data\backtest.json" -Force }

Write-Host "=== ALL RUNS ==="
$out | Sort-Object -Property excess -Descending | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
