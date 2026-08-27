# Filter and holding-period experiments, decided in advance and all reported.
#
# Measurement showed the Stage-1 filters, not the factor weights, are what
# eject the companies that drove the index. Each run relaxes ONE thing so the
# effect is attributable, plus two swing variants on shorter holds.

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$runs = @(
  @{ name = "baseline";          args = "" },
  @{ name = "no-current-ratio";  args = "--no-current-ratio" },
  @{ name = "no-trend";          args = "--no-trend" },
  @{ name = "exempt-financials"; args = "--exempt-financials" },
  @{ name = "filters-relaxed";   args = "--no-current-ratio --no-trend --exempt-financials" },
  @{ name = "swing-2month";      args = "--rebalance 42" },
  @{ name = "swing-monthly";     args = "--rebalance 21" },
  @{ name = "relaxed-swing2mo";  args = "--no-current-ratio --no-trend --exempt-financials --rebalance 42" }
)

$out = @()
foreach ($r in $runs) {
  Write-Host "=== $($r.name) ==="
  cmd /c "npm run backtest -- $($r.args) > filt-$($r.name).log 2>&1"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED"; Get-Content "filt-$($r.name).log" -Tail 3; continue
  }
  $j = Get-Content "data\backtest.json" -Raw | ConvertFrom-Json
  Copy-Item "data\backtest.json" "filt-$($r.name).json" -Force
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
[System.IO.File]::WriteAllText("$repo\filter-results.json", ($out | ConvertTo-Json -Depth 3))
Write-Host "=== ALL RUNS ==="
$out | Sort-Object -Property excess -Descending | Format-Table -AutoSize | Out-String | Write-Host
