param(
  [string]$OutDir = "",
  [string]$Version = ""
)

. (Join-Path $PSScriptRoot "kwipu-common.ps1")

$root = Get-KwipuPluginRoot
if (-not $OutDir) {
  $OutDir = Join-Path $root "dist"
}
if (-not $Version) {
  $package = Get-Content -Path (Join-Path $root "package.json") -Encoding UTF8 | ConvertFrom-Json
  $Version = $package.version
}

$staging = Join-Path $OutDir "kwipu-related-context"
$zipPath = Join-Path $OutDir "kwipu-related-context-$Version.zip"

if (Test-Path $staging) {
  Remove-Item -Recurse -Force $staging
}
New-Item -ItemType Directory -Force -Path $staging | Out-Null

Copy-KwipuPluginFiles -TargetDir $staging

$required = @(
  "manifest.json",
  "main.js",
  "styles.css",
  "README.md",
  "TODO.md",
  "package.json",
  ".env.example",
  "scripts"
)
foreach ($item in $required) {
  $path = Join-Path $staging $item
  if (-not (Test-Path $path)) {
    throw "release 包缺少必要文件：$item"
  }
}

$blocked = @("data.json", ".env")
foreach ($file in $blocked) {
  $path = Join-Path $staging $file
  if (Test-Path $path) {
    Remove-Item -Force $path
  }
}

if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -Force
Write-Host "Release package: $zipPath"
