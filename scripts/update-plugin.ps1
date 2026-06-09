param(
  [string]$EnvFile = "",
  [string]$VaultDir = "",
  [string]$TargetDir = ""
)

. (Join-Path $PSScriptRoot "kwipu-common.ps1")

if (-not $EnvFile) {
  $EnvFile = Join-Path (Get-KwipuPluginRoot) ".env"
}

Initialize-KwipuEnv -EnvFile $EnvFile

if (-not $VaultDir) {
  $VaultDir = Get-KwipuEnv -Name "KWIPU_KNOWLEDGE_DIR"
}

if (-not $TargetDir) {
  $TargetDir = Join-Path $VaultDir ".obsidian\plugins\kwipu-related-context"
}

$dataPath = Join-Path $TargetDir "data.json"
$hadData = Test-Path $dataPath

& (Join-Path $PSScriptRoot "install-plugin.ps1") -EnvFile $EnvFile -VaultDir $VaultDir -TargetDir $TargetDir

if ($hadData -and (Test-Path $dataPath)) {
  Write-Host "data.json 已保留。"
} elseif ($hadData) {
  throw "更新后 data.json 不存在，请检查目标目录：$TargetDir"
}
