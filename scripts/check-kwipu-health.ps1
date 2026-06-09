param(
  [string]$EnvFile = "",
  [string]$Endpoint = ""
)

. (Join-Path $PSScriptRoot "kwipu-common.ps1")

if (-not $EnvFile) {
  $EnvFile = Join-Path (Get-KwipuPluginRoot) ".env"
}

Initialize-KwipuEnv -EnvFile $EnvFile

if (-not $Endpoint) {
  $Endpoint = Get-KwipuEndpoint
}

$url = "$($Endpoint.TrimEnd('/'))/health"
Write-Host "GET $url"
$response = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 15
$response | ConvertTo-Json -Depth 8
