$ErrorActionPreference = 'Stop'
$repoRoot = Join-Path $PSScriptRoot ('test-network-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $repoRoot 'docs/data') -Force | Out-Null
try {
. (Join-Path $PSScriptRoot 'write-network-snapshot.ps1')
$script:mockTip = 112381
function wsl.exe {
  $global:LASTEXITCODE = 0
  if ($args -contains 'getblockchaininfo') { return ('{"blocks":' + $script:mockTip + ',"difficulty":42}') }
  if ($args -contains 'getnetworkhashps') { return '123456' }
  if ($args -contains 'getmempoolinfo') { return '{"size":0}' }
  throw 'Unexpected RPC method'
}
Write-PublicNetworkSnapshot -ScannerHeight 112381 -MapHeight 112381
$snapshotPath = Join-Path $repoRoot 'docs/data/network.json'
$first = Get-Content -Raw -LiteralPath $snapshotPath | ConvertFrom-Json
if ($first.node_chain_tip -ne 112381 -or $first.publishing_interval_seconds -ne 3600) { throw 'Invalid snapshot fields' }
# Same height must still replace an old timestamp.
$oldJson = (Get-Content -Raw -LiteralPath $snapshotPath) -replace '"generated_at":\s*"[^"]+"', '"generated_at":"2020-01-01T00:00:00Z"'
$oldJson | Set-Content -LiteralPath $snapshotPath
Write-PublicNetworkSnapshot -ScannerHeight 112381 -MapHeight 112381
$second = Get-Content -Raw -LiteralPath $snapshotPath | ConvertFrom-Json
if ([DateTimeOffset]::Parse($second.generated_at).Year -le 2020) { throw 'Unchanged-block heartbeat was not refreshed' }
$before = Get-Content -Raw -LiteralPath $snapshotPath
$script:mockTip = 112380
$rejected = $false
try { Write-PublicNetworkSnapshot -ScannerHeight 112381 -MapHeight 112381 } catch { $rejected = $true }
if (-not $rejected) { throw 'Inconsistent heights accepted' }
if ((Get-Content -Raw -LiteralPath $snapshotPath) -ne $before) { throw 'Failed query overwrote valid snapshot' }
# Exercise the full updater's equal-height branch with isolated command doubles.
$script:mockTip = 112381
$global:qtcStages = @()
$global:qtcPublished = $false
$gitExe = 'qtc-test-git'
function Invoke-LoggedExternal([scriptblock]$Command) { & $Command | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Mock command failed' } }
function qtc-test-git {
  $global:qtcStages += ($args -join ' ')
  if ($args[0] -eq 'diff') { $global:LASTEXITCODE = 1 } else { $global:LASTEXITCODE = 0 }
}
function Invoke-Publish { $global:qtcPublished = $true; return 0 }
function Write-Log([string]$Message) {}
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'refresh-funded-map.ps1')
$branchStart = $source.IndexOf('  if ([int]$tip -eq [int]$published.verified_block) {')
$branchEnd = $source.IndexOf('  Write-Log "New indexed block detected', $branchStart)
if ($branchStart -lt 0 -or $branchEnd -le $branchStart) { throw 'Updater equal-height branch not found' }
$branch = $source.Substring($branchStart, $branchEnd-$branchStart) -replace '(?m)^    exit 0$', '    $global:qtcBranchDone = $true'
$tip = '112381'
$published = @{verified_block=112381}
& ([scriptblock]::Create($branch))
if (-not $global:qtcPublished -or -not $global:qtcBranchDone) { throw 'Unchanged-block publication branch skipped' }
if (-not ($global:qtcStages | Where-Object { $_ -like 'commit *' })) { throw 'Network heartbeat was not committed' }
Write-Host 'PASS: snapshot refreshed and published at unchanged height; invalid heights preserve the previous file.'
} finally {
  $resolvedTestRoot = [System.IO.Path]::GetFullPath($repoRoot)
  $allowedPrefix = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'test-network-'))
  if (-not $resolvedTestRoot.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove an unexpected test directory.'
  }
  Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
}
