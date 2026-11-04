# Machine-specific values stay in an ignored local data file, never in public source.
function Get-QtcRefreshConfiguration([string]$RepositoryRoot) {
  $configurationPath = Join-Path $RepositoryRoot 'data/private/refresh-config.psd1'
  if (-not (Test-Path -LiteralPath $configurationPath -PathType Leaf)) {
    throw 'Local refresh configuration is missing. Configure data/private/refresh-config.psd1 from the public example before running the updater.'
  }
  $configuration = Import-PowerShellDataFile -LiteralPath $configurationPath
  $required = @('WslDistribution', 'WslUser', 'DatabasePath', 'IndexerPath',
    'NodeExe', 'GitExe', 'CliExecutable', 'CliDataDirectory', 'CliConfigFile')
  foreach ($name in $required) {
    if (-not ($configuration[$name] -is [string]) -or
        [string]::IsNullOrWhiteSpace($configuration[$name]) -or
        $configuration[$name] -match 'REPLACE_ME') {
      throw "Local refresh configuration has an invalid or missing field: $name"
    }
  }
  return $configuration
}
