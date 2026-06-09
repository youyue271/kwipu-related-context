param(
  [string]$EnvFile = "",
  [string]$ProjectDir = "",
  [switch]$Full
)

. (Join-Path $PSScriptRoot "kwipu-common.ps1")

if (-not $EnvFile) {
  $EnvFile = Join-Path (Get-KwipuPluginRoot) ".env"
}

Initialize-KwipuEnv -EnvFile $EnvFile

if (-not $ProjectDir) {
  $ProjectDir = Get-KwipuEnv -Name "KWIPU_PROJECT_DIR"
}

$serverPath = Join-Path $ProjectDir "kwipu_http_server.py"
if (-not (Test-Path $serverPath)) {
  throw "找不到 kwipu_http_server.py：$serverPath"
}

$hostName = Get-KwipuEnv -Name "KWIPU_HTTP_HOST" -Default "127.0.0.1"
$port = Get-KwipuEnv -Name "KWIPU_HTTP_PORT" -Default "8765"
$llmModel = Get-KwipuEnv -Name "KWIPU_LLM_MODEL"
$embedModel = Get-KwipuEnv -Name "KWIPU_EMBED_MODEL"

Write-Host "Kwipu project: $ProjectDir"
Write-Host "Knowledge: $(Get-KwipuEnv -Name "KWIPU_KNOWLEDGE_DIR")"
Write-Host "Storage: $(Get-KwipuEnv -Name "KWIPU_STORAGE_DIR")"
Write-Host "Endpoint: http://${hostName}:${port}"
Write-Host "LLM: $llmModel"
Write-Host "Embedding: $embedModel"
Write-Host "KWIPU_NUM_CTX: $(Get-KwipuEnv -Name "KWIPU_NUM_CTX")"
Write-Host "KWIPU_EMBED_MAX_CHARS: $(Get-KwipuEnv -Name "KWIPU_EMBED_MAX_CHARS")"

Push-Location $ProjectDir
try {
  $args = @(
    "kwipu_http_server.py",
    "--host", $hostName,
    "--port", $port,
    "--llm-model", $llmModel,
    "--embed-model", $embedModel
  )
  if ($Full) {
    $args += "--full"
  }
  & python @args
} finally {
  Pop-Location
}
