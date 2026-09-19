# Do the spec's five enhancements actually help?
#
# They were built behind switches with the note "they earn their place by
# measurement or not at all", and then never measured. Each has a plausible
# story; so did the six factor tilts that lost, and the monthly rebalance that
# beat the index in sample and failed out of sample.
#
# Control is the plain spec. Each variant changes exactly one thing, and every
# run writes its own file via --out so none can touch the published backtest.

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
