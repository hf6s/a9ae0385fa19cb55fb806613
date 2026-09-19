# Do the spec's five enhancements actually help?
#
# They were built behind switches with the note "they earn their place by
# measurement or not at all", and then never measured. Each has a plausible
# story; so did the six factor tilts that lost, and the monthly rebalance that
# beat the index in sample and failed out of sample.
#
# Control is the plain spec. Each variant changes exactly one thing, and every
# run writes its own file via --out so none can touch the published backtest.
#
# RESULT, 2026-09-19, all seven runs on the same data (797 priced tickers,
# benchmark 14.6% CAGR over 13.9y):
#
#   run                 CAGR   vs control   Sharpe   MaxDD   hit    10y windows beaten
#   control             12.7        0.0      0.75   -34.8   51.8%   6%
#   shareholder-yield   13.7       +1.0      0.79   -36.9   55.4%   9%
#   volatility          12.5       -0.2      0.75   -35.1   50.0%   1%
#   piotroski-factor    12.3       -0.4      0.73   -35.5   46.4%   0%
#   all-five            12.1       -0.6      0.73   -33.7   48.2%   1%
#   sector-relative     11.8       -0.9      0.71   -33.6   44.6%   0%
#   zscore              11.6       -1.1      0.68   -36.3   44.6%   0%
#
# Shareholder yield is the only one that helps, and it helps in both halves
# (+1.2 vs +0.7 excess in the first, -3.2 vs -4.5 in the second) and at every
# window length (1y 51% vs 44%, 3y 48% vs 40%, 5y 26% vs 17%, 10y 9% vs 6%).
# That consistency is the strongest evidence any variant has produced here.
# It still trails the index, and it cannot be checked out of sample: oos.ts
# runs on the LSE, where shareholderYield is null because the input comes from
# US filings. So it stays OFF until that limitation is addressed or the owner
# accepts an in-sample-only result.
#
# CORRECTION. An earlier commit reported all four of the first variants losing
# by 1.5-2.6 points. Those runs were made on 2026-09-06 while the EODHD
# subscription had lapsed: 635 priced tickers instead of 797, and a benchmark
# that came out 137 points low. Control and variant were equally degraded, but
# the numbers were not comparable to anything and should not be cited. The
# table above replaces them.

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$runs = @(
  @{ name = "control";           args = "" },
  @{ name = "sector-relative";   args = "--sector-relative" },
  @{ name = "volatility";        args = "--volatility" },
  @{ name = "piotroski-factor";  args = "--piotroski-factor" },
  @{ name = "shareholder-yield"; args = "--shareholder-yield" },
  @{ name = "zscore";            args = "--zscore" },
  @{ name = "all-five";          args = "--enhanced" }
)

$out = @()
foreach ($r in $runs) {
  Write-Host "=== $($r.name) ==="
  cmd /c "npm run backtest -- $($r.args) --out enh-$($r.name).json > enh-$($r.name).log 2>&1"
  if ($LASTEXITCODE -ne 0) { Write-Host "  FAILED"; Get-Content "enh-$($r.name).log" -Tail 3; continue }
  $j = Get-Content "enh-$($r.name).json" -Raw | ConvertFrom-Json
  $s = $j.stats
  $r10 = $j.rollingWindows | Where-Object { $_.years -eq 10 }
  $out += [pscustomobject]@{
    run      = $r.name
    cagr     = $s.cagr
    excess   = [math]::Round($s.cagr - $s.benchCagr, 2)
    sharpe   = $s.sharpe
    maxDD    = $s.maxDrawdown
    vol      = $s.annVol
    turnover = $s.avgTurnoverPct
    hit      = [math]::Round($s.quartersBeatingIndex / $s.quartersTotal * 100, 1)
    win10y   = if ($r10) { $r10.beatPct } else { $null }
    h1       = if ($j.subPeriods) { $j.subPeriods[0].excess } else { $null }
    h2       = if ($j.subPeriods) { $j.subPeriods[1].excess } else { $null }
  }
  $out[-1] | Format-List | Out-String | Write-Host
}
[System.IO.File]::WriteAllText("$repo\enh-results.json", ($out | ConvertTo-Json -Depth 3))
Write-Host "=== ALL ==="
$out | Format-Table -AutoSize | Out-String | Write-Host
