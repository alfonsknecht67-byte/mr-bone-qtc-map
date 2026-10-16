$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dbPath = '/home/juliajan/qubitcoin-monitor/data/qubitcoin_monitor.db'
$logPath = Join-Path $repoRoot 'data/raw/refresh.log'
$mapPath = Join-Path $repoRoot 'docs/data/map.json'
$rawPath = Join-Path $repoRoot 'data/raw/approved-scan.json'
$nodeExe = 'C:/Users/julia/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$gitExe = 'C:/Program Files/Git/cmd/git.exe'


New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
function Write-Log([string]$message) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message" | Tee-Object -FilePath $logPath -Append
}


function Invoke-LoggedExternal([scriptblock]$Command) {
  $savedPreference = $ErrorActionPreference
  $nativeExit = $null
  try {
    $ErrorActionPreference = 'Continue'
    & $Command *>> $logPath
    $nativeExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedPreference
  }
  $global:LASTEXITCODE = $nativeExit
  if ($null -eq $nativeExit -or $nativeExit -ne 0) {
    throw "External command failed (exit $nativeExit). See $logPath for full output."
  }
}

function Invoke-Publish {
  # Windows PowerShell treats Git's ordinary stderr progress as errors.
  # Use Git's exit code to distinguish a successful push from a failure.
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $gitExe push origin main *>> $logPath
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

try {
  Set-Location $repoRoot
  $repoWsl = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- wslpath -a ($repoRoot.Replace('\', '/')) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $repoWsl) { throw 'Could not resolve the project path inside WSL.' }

  Write-Log "Catching up the local scanner before export."
  Invoke-LoggedExternal { & wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- flock -n /tmp/mrbone-qtc-indexer.lock python3 -u /home/juliajan/qubitcoin-monitor/chain_indexer.py }
  if ($LASTEXITCODE -ne 0) { throw 'Scanner catch-up failed or another refresh is indexing; publication skipped.' }

  $tip = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- python3 "$repoWsl/tools/read-index-height.py" $dbPath | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $tip -notmatch '^\d+$') { throw 'Could not read the indexed block height from the scanner database.' }

  $published = Get-Content -Raw $mapPath | ConvertFrom-Json
  if ([int]$tip -eq [int]$published.verified_block) {
    $ahead = (& $gitExe rev-list --count origin/main..main | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $ahead -match '^\d+$' -and [int]$ahead -gt 0) {
      Write-Log "Retrying publication of $ahead already committed local update(s)."
      $pushExitCode = Invoke-Publish
      if ($pushExitCode -ne 0) { throw 'Could not publish pending commits; they will be retried on the next scheduled run.' }
    }
    Write-Log "No new indexed block (still $tip); map unchanged. This does not confirm that the scanner has reached the node tip."
    exit 0
  }

  Write-Log "New indexed block detected ($($published.verified_block) -> $tip); exporting funded addresses."
  $rawWsl = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- wslpath -a ($rawPath.Replace('\', '/')) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $rawWsl) { throw 'Could not resolve the export path inside WSL.' }
  Invoke-LoggedExternal { & wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- python3 "$repoWsl/tools/export-full-map.py" $dbPath $rawWsl 0 }
  if ($LASTEXITCODE -ne 0) { throw "The blockchain export failed with exit code $LASTEXITCODE." }

  Invoke-LoggedExternal { & $nodeExe tools/build-public-map.mjs data/raw/approved-scan.json docs/data/map.json }
  if ($LASTEXITCODE -ne 0) { throw "The public map build failed with exit code $LASTEXITCODE." }

  Invoke-LoggedExternal { & wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- python3 "$repoWsl/tools/observation.py" $rawWsl "$repoWsl/docs/data/map.json" --db $dbPath }
  if ($LASTEXITCODE -ne 0) { throw 'Observation export failed; inconsistent reports will not be published.' }

  # Publish the same node state as a lightweight public network snapshot.
  # qubitcoin-cli uses the existing local RPC configuration; no credentials are copied.
  $cliPath = '$HOME/qubitcoin-source/src/qubitcoin-cli -datadir=$HOME/qubitcoin/data -conf=$HOME/qubitcoin/data/qubitcoin.conf'
  $rpcJson = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- bash -lc "$cliPath getblockchaininfo" 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $rpcJson) { throw 'Could not query qubitcoind for network status.' }
  $rpc = $rpcJson | ConvertFrom-Json
  $networkHash = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- bash -lc "$cliPath getnetworkhashps 120" 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $networkHash -notmatch '^[0-9.eE+\-]+$') { throw 'Could not query network hashrate.' }
  $fresh = Get-Content -Raw $mapPath | ConvertFrom-Json
  if ([int]$fresh.verified_block -le [int]$published.verified_block) {
    Write-Log "Export did not advance beyond block $($published.verified_block); skipping publication."
    exit 0
  }
  $mempoolJson = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- bash -lc "$cliPath getmempoolinfo" 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $mempoolJson) { throw 'Could not query mempool status.' }
  $mempool = $mempoolJson | ConvertFrom-Json
  $networkSnapshot = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    source = 'local-qubitcoin-node'
    block = [int]$rpc.blocks
    latest_indexed_block = [int]$fresh.verified_block
    scanner_indexed_block = [int]$tip
    node_chain_tip = [int]$rpc.blocks
    difficulty = [double]$rpc.difficulty
    network_hashps = [double]$networkHash
    tx_count = [int]$mempool.size
    pooledtx = [int]$mempool.size
  }
  $networkSnapshot | ConvertTo-Json | Set-Content -Path (Join-Path $repoRoot 'docs/data/network.json') -Encoding utf8
  & $gitExe add -- docs/data/map.json docs/data/small-flows.json docs/data/network.json docs/data/history docs/data/observation.json docs/data/transactions.json
  if ($LASTEXITCODE -ne 0) { throw 'Could not stage the refreshed map.' }
  Invoke-LoggedExternal { & $gitExe commit -m "Refresh funded wallet map through block $($fresh.verified_block)" }
  if ($LASTEXITCODE -ne 0) { throw 'Could not commit the refreshed map.' }
  $pushExitCode = Invoke-Publish
  if ($pushExitCode -ne 0) { throw 'Could not publish the refreshed map; it will be retried on the next scheduled run.' }
  Write-Log "Published funded map through block $($fresh.verified_block): $($fresh.nodes.Count) addresses, $($fresh.edges.Count) links."
} catch {
  Write-Log "Refresh failed: $($_.Exception.Message)"
  exit 1
}
