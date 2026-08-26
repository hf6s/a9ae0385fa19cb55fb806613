# Six factor tilts, decided in advance and all reported.
#
# The spec's 30/25/25/20 is one hypothesis. It encodes a value-and-quality tilt
# that this sample punished, so the alternatives are worth one honest test each.
# Picking the winner of six on one sample is itself a selection bias, which is
# why the sub-period split matters more than the headline.

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$tilts = @(
  @{ name = "spec-30-25-25-20"; w = "30,25,25,20" },
  @{ name = "momentum-heavy";   w = "10,10,60,20" },
  @{ name = "growth-momentum";  w = "10,10,40,40" },
  @{ name = "quality-heavy";    w = "50,20,15,15" },
  @{ name = "value-heavy";      w = "20,50,15,15" },
  @{ name = "equal-weight";     w = "25,25,25,25" }
)

$out = @()
foreach ($t in $tilts) {
  Write-Host "=== $($t.name)  [$($t.w)] ==="
  cmd /c "npm run backtest -- --weights $($t.w) > tilt-$($t.name).log 2>&1"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED"; Get-Content "tilt-$($t.name).log" -Tail 2; continue
  }
  $j = Get-Content "data\backtest.json" -Raw | ConvertFrom-Json
  Copy-Item "data\backtest.json" "tilt-$($t.name).json" -Force
  $out += [pscustomobject]@{
    tilt   = $t.name
    cagr   = $j.stats.cagr
    bench  = $j.stats.benchCagr
    excess = [math]::Round($j.stats.cagr - $j.stats.benchCagr, 2)
    sharpe = $j.stats.sharpe
    maxDD  = $j.stats.maxDrawdown
    h1     = if ($j.subPeriods) { $j.subPeriods[0].excess } else { $null }
    h2     = if ($j.subPeriods) { $j.subPeriods[1].excess } else { $null }
  }
  $out[-1] | Format-Table | Out-String | Write-Host
}
$out | ConvertTo-Json -Depth 3 | Set-Content "tilt-results.json" -Encoding utf8
Write-Host "=== ALL TILTS ==="
$out | Sort-Object -Property excess -Descending | Format-Table -AutoSize | Out-String | Write-Host
