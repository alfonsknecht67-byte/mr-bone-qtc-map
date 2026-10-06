$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dbPath = '/home/juliajan/qubitcoin-monitor/data/qubitcoin_monitor.db'
$logPath = Join-Path $repoRoot 'data/raw/refresh.log'
$mapPath = Join-Path $repoRoot 'docs/data/map.json'
$rawPath = Join-Path $repoRoot 'data/raw/approved-scan.json'

New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
function Write-Log([string]$message) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message" | Tee-Object -FilePath $logPath -Append
}

try {
  Set-Location $repoRoot
  $repoWsl = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- wslpath -a $repoRoot).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $repoWsl) { throw 'Could not resolve the project path inside WSL.' }

  $tipCode = 'import sqlite3,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(c.execute("SELECT COALESCE(MAX(block_height),0) FROM chain_index").fetchone()[0])'
  $tip = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- python3 -c $tipCode $dbPath).Trim()
  if ($LASTEXITCODE -ne 0 -or $tip -notmatch '^\d+$') { throw 'Could not read the indexed block height from the scanner database.' }

  $published = Get-Content -Raw $mapPath | ConvertFrom-Json
  if ([int]$tip -eq [int]$published.verified_block) {
    $ahead = (& git rev-list --count origin/main..main).Trim()
    if ($LASTEXITCODE -eq 0 -and $ahead -match '^\d+$' -and [int]$ahead -gt 0) {
      Write-Log "Retrying publication of $ahead already committed local update(s)."
      & git push origin main *>> $logPath
      if ($LASTEXITCODE -ne 0) { throw 'Could not publish pending commits; they will be retried on the next scheduled run.' }
    }
    Write-Log "No new indexed block (still $tip); map is current."
    exit 0
  }

  Write-Log "New indexed block detected ($($published.verified_block) -> $tip); exporting funded addresses."
  $rawWsl = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- wslpath -a $rawPath).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $rawWsl) { throw 'Could not resolve the export path inside WSL.' }
  & wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- python3 "$repoWsl/tools/export-full-map.py" $dbPath $rawWsl 1000 *>> $logPath
  if ($LASTEXITCODE -ne 0) { throw "The blockchain export failed with exit code $LASTEXITCODE." }

  & node tools/build-public-map.mjs data/raw/approved-scan.json docs/data/map.json *>> $logPath
  if ($LASTEXITCODE -ne 0) { throw "The public map build failed with exit code $LASTEXITCODE." }

  # Publish the same node state as a lightweight public network snapshot.
  # qubitcoin-cli uses the existing local RPC configuration; no credentials are copied.
  $cliPath = '$HOME/qubitcoin-source/src/qubitcoin-cli'
  $rpcJson = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- bash -lc "$cliPath getblockchaininfo" 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $rpcJson) { throw 'Could not query qubitcoind for network status.' }
  $rpc = $rpcJson | ConvertFrom-Json
  $networkHash = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- bash -lc "$cliPath getnetworkhashps 120" 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $networkHash -notmatch '^[0-9.eE+\-]+  $fresh = Get-Content -Raw $mapPath | ConvertFrom-Json
  if ([int]$fresh.verified_block -le [int]$published.verified_block) {
    Write-Log "Export did not advance beyond block $($published.verified_block); skipping publication."
    exit 0
  }

  & git add -- docs/data/map.json docs/data/network.json
  if ($LASTEXITCODE -ne 0) { throw 'Could not stage the refreshed map.' }
  & git commit -m "Refresh funded wallet map through block $($fresh.verified_block)" *>> $logPath
  if ($LASTEXITCODE -ne 0) { throw 'Could not commit the refreshed map.' }
  & git push origin main *>> $logPath
  if ($LASTEXITCODE -ne 0) { throw 'Could not publish the refreshed map; it will be retried on the next scheduled run.' }

  Write-Log "Published funded map through block $($fresh.verified_block): $($fresh.nodes.Count) addresses, $($fresh.edges.Count) links."
} catch {
  Write-Log "Refresh failed: $($_.Exception.Message)"
  exit 1
}
) { $networkHash = '0' }
  $mempoolJson = (& wsl.exe -d Qubitcoin-Ubuntu -u juliajan -- bash -lc "$cliPath getmempoolinfo" 2>$null).Trim()
  $mempool = if ($mempoolJson) { $mempoolJson | ConvertFrom-Json } else { $null }

  $networkSnapshot = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    source = 'local-qubitcoin-node'
    block = [int]$rpc.blocks
    latest_indexed_block = [int]$fresh.verified_block
    node_chain_tip = [int]$rpc.blocks
    difficulty = [double]$rpc.difficulty
    network_hashps = [double]$networkHash
    tx_count = if ($mempool) { [int]$mempool.size } else { 0 }
    pooledtx = if ($mempool) { [int]$mempool.size } else { 0 }
  }
  $networkSnapshot | ConvertTo-Json | Set-Content -Path (Join-Path $repoRoot 'docs/data/network.json') -Encoding utf8

  $fresh = Get-Content -Raw $mapPath | ConvertFrom-Json
  if ([int]$fresh.verified_block -le [int]$published.verified_block) {
    Write-Log "Export did not advance beyond block $($published.verified_block); skipping publication."
    exit 0
  }

  & git add -- docs/data/map.json docs/data/network.json
  if ($LASTEXITCODE -ne 0) { throw 'Could not stage the refreshed map.' }
  & git commit -m "Refresh funded wallet map through block $($fresh.verified_block)" *>> $logPath
  if ($LASTEXITCODE -ne 0) { throw 'Could not commit the refreshed map.' }
  & git push origin main *>> $logPath
  if ($LASTEXITCODE -ne 0) { throw 'Could not publish the refreshed map; it will be retried on the next scheduled run.' }

  Write-Log "Published funded map through block $($fresh.verified_block): $($fresh.nodes.Count) addresses, $($fresh.edges.Count) links."
} catch {
  Write-Log "Refresh failed: $($_.Exception.Message)"
  exit 1
}
