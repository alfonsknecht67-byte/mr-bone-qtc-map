# Called by the hourly map refresh, including runs with no new indexed block.
function Write-PublicNetworkSnapshot([int]$ScannerHeight, [int]$MapHeight) {
  $cliArgs = @('-d', 'Qubitcoin-Ubuntu', '-u', 'juliajan', '--',
    '/home/juliajan/qubitcoin-source/src/qubitcoin-cli',
    '-datadir=/home/juliajan/qubitcoin/data',
    '-conf=/home/juliajan/qubitcoin/data/qubitcoin.conf')
  $chainJson = (& wsl.exe @cliArgs getblockchaininfo | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $chainJson) { throw 'Could not query node blockchain status.' }
  $chain = $chainJson | ConvertFrom-Json
  $hashJson = (& wsl.exe @cliArgs getnetworkhashps 120 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $hashJson -notmatch '^[0-9.eE+\-]+$') { throw 'Could not query network hashrate.' }
  $mempoolJson = (& wsl.exe @cliArgs getmempoolinfo | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $mempoolJson) { throw 'Could not query mempool status.' }
  $mempool = $mempoolJson | ConvertFrom-Json
  if ($null -eq $chain.blocks -or [long]$chain.blocks -lt $ScannerHeight -or $MapHeight -gt $ScannerHeight) {
    throw 'Node, scanner and map heights are inconsistent; snapshot not written.'
  }
  $snapshot = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    source = 'local-qubitcoin-node'
    publishing_interval_seconds = 3600
    block = [int]$chain.blocks
    latest_indexed_block = $MapHeight
    scanner_indexed_block = $ScannerHeight
    node_chain_tip = [int]$chain.blocks
    difficulty = [double]$chain.difficulty
    network_hashps = [double]$hashJson
    tx_count = [int]$mempool.size
    pooledtx = [int]$mempool.size
  }
  $output = Join-Path $repoRoot 'docs/data/network.json'
  $temporary = $output + '.tmp'
  $snapshot | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding utf8
  Move-Item -LiteralPath $temporary -Destination $output -Force
}
