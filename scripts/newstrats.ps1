# Genuinely different strategy families, not more weight-tuning.
#
# Each is a distinct documented hypothesis, decided in advance:
#   concentration  - fewer, higher-conviction names
#   trend overlay  - Faber's rule: sit in cash when the index is below its 200MA
#   leverage       - the arithmetically honest route to "2x the index"
# All results reported, including the ones that lose.

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$runs = @(
  @{ name = "monthly-base";      args = "--rebalance 21" },
  @{ name = "monthly-top10";     args = "--rebalance 21 --top 10" },
  @{ name = "monthly-top5";      args = "--rebalance 21 --top 5" },
  @{ name = "cash-when-bear";    args = "--cash-when-bear" },
  @{ name = "monthly-cash-bear"; args = "--rebalance 21 --cash-when-bear" },
  @{ name = "monthly-lev15";     args = "--rebalance 21 --leverage 1.5" },
  @{ name = "monthly-lev2";      args = "--rebalance 21 --leverage 2" },
  @{ name = "mo-cash-lev2";      args = "--rebalance 21 --cash-when-bear --leverage 2" }
)

$out = @()
foreach ($r in $runs) {
  Write-Host "=== $($r.name) ==="
  # --out keeps the run out of data/backtest.json, which the live site reads.
  cmd /c "npm run backtest -- $($r.args) --out ns-$($r.name).json > ns-$($r.name).log 2>&1"
  if ($LASTEXITCODE -ne 0) { Write-Host "  FAILED"; Get-Content "ns-$($r.name).log" -Tail 3; continue }
  $j = Get-Content "ns-$($r.name).json" -Raw | ConvertFrom-Json
  $out += [pscustomobject]@{
    run    = $r.name
    cagr   = $j.stats.cagr
    bench  = $j.stats.benchCagr
    excess = [math]::Round($j.stats.cagr - $j.stats.benchCagr, 2)
    sharpe = $j.stats.sharpe
    maxDD  = $j.stats.maxDrawdown
    vol    = $j.stats.annVol
    h1     = if ($j.subPeriods) { $j.subPeriods[0].excess } else { $null }
    h2     = if ($j.subPeriods) { $j.subPeriods[1].excess } else { $null }
  }
  $out[-1] | Format-List | Out-String | Write-Host
}
[System.IO.File]::WriteAllText("$repo\newstrat-results.json", ($out | ConvertTo-Json -Depth 3))
Write-Host "=== ALL ==="
$out | Sort-Object -Property excess -Descending | Format-Table -AutoSize | Out-String | Write-Host
