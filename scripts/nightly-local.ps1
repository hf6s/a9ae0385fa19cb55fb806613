# Factor20 nightly local scan - run by the "Factor20 nightly scan" scheduled task.
#
# This replaces the scan leg of .github/workflows/nightly.yml: Yahoo Finance
# blocks GitHub Actions' datacenter IPs, so price history only fetches from a
# residential IP like this PC. A failed scan exits before committing (scan.ts
# has its own MIN_SURVIVORS guard), so good data is never overwritten.
#
# NOTE: keep this file ASCII-only. The scheduled task runs Windows PowerShell
# 5.1, which reads BOM-less files as ANSI; non-ASCII characters can decode
# into quote characters and corrupt the script.

$repo = "C:\Users\marky\Desktop\factor20"
$npm = "C:\Program Files\nodejs\npm.cmd"
$log = Join-Path $repo "nightly-task.log"

Set-Location $repo

# Keep the log from growing forever
if ((Test-Path $log) -and (Get-Item $log).Length -gt 512KB) {
    Get-Content $log -Tail 200 | Set-Content "$log.tmp" -Encoding utf8
    Move-Item "$log.tmp" $log -Force
}

Add-Content $log "`n=== nightly run started $(Get-Date -Format s) ===" -Encoding utf8

# Dependencies are gitignored, so a fresh clone (or a factory reset) leaves
# node_modules missing and every run dies with "tsx is not recognized".
if (-not (Test-Path (Join-Path $repo "node_modules\.bin\tsx.cmd"))) {
    Add-Content $log "node_modules missing - running npm ci first" -Encoding utf8
    cmd /c "`"$npm`" ci >> `"$log`" 2>&1"
    if ($LASTEXITCODE -ne 0) {
        Add-Content $log "npm ci failed (exit $LASTEXITCODE) - aborting, nothing committed" -Encoding utf8
        exit 1
    }
}

cmd /c "`"$npm`" run scan >> `"$log`" 2>&1"
if ($LASTEXITCODE -ne 0) {
    Add-Content $log "scan failed (exit $LASTEXITCODE) - keeping previous rankings, nothing committed" -Encoding utf8
    exit 1
}

cmd /c "`"$npm`" run analyze >> `"$log`" 2>&1"
if ($LASTEXITCODE -ne 0) {
    Add-Content $log "analyze failed (exit $LASTEXITCODE) - committing scan data without fresh AI write-ups" -Encoding utf8
}

git add data/
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    cmd /c "git commit -m `"data: nightly rankings + analysis (local)`" >> `"$log`" 2>&1"
    cmd /c "git push >> `"$log`" 2>&1"
    if ($LASTEXITCODE -ne 0) {
        Add-Content $log "git push failed - data is committed locally; next successful push carries it" -Encoding utf8
    }
} else {
    Add-Content $log "no data changes to commit" -Encoding utf8
}

Add-Content $log "=== nightly run finished $(Get-Date -Format s) ===" -Encoding utf8
