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

Copy-KwipuPluginFiles -TargetDir $TargetDir

Write-Host "已安装或更新插件到：$TargetDir"
Write-Host "已复制 manifest.json、main.js、styles.css、README、TODO 和 scripts。"
Write-Host "如果目录中已有 data.json，它会保留为 Obsidian 插件设置和缓存。"
