$ErrorActionPreference = "Stop"

function Get-KwipuPluginRoot {
  Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}

function Import-KwipuEnv {
  param(
    [string]$EnvFile = (Join-Path (Get-KwipuPluginRoot) ".env")
  )

  if (-not (Test-Path $EnvFile)) {
    return
  }

  Get-Content -Path $EnvFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
      return
    }
    $parts = $line.Split("=", 2)
    if ($parts.Count -ne 2) {
      return
    }
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Set-KwipuDefaultEnv {
  param(
    [string]$Name,
    [string]$Value
  )

  if (-not [Environment]::GetEnvironmentVariable($Name, "Process")) {
    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
  }
}

function Get-KwipuEnv {
  param(
    [string]$Name,
    [string]$Default = ""
  )

  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ($value) {
    return $value
  }
  return $Default
}

function Initialize-KwipuEnv {
  param(
    [string]$EnvFile = (Join-Path (Get-KwipuPluginRoot) ".env")
  )

  Import-KwipuEnv -EnvFile $EnvFile
  Set-KwipuDefaultEnv -Name "KWIPU_PROJECT_DIR" -Value "D:\project\Kwipu"
  Set-KwipuDefaultEnv -Name "KWIPU_KNOWLEDGE_DIR" -Value "D:\repo"
  Set-KwipuDefaultEnv -Name "KWIPU_STORAGE_DIR" -Value "D:\repo\00 rag storage"
  Set-KwipuDefaultEnv -Name "KWIPU_LLM_MODEL" -Value "qwen3.6:35b-a3b-q4_K_M"
  Set-KwipuDefaultEnv -Name "KWIPU_EMBED_MODEL" -Value "bge-m3:567m"
  Set-KwipuDefaultEnv -Name "KWIPU_HTTP_HOST" -Value "127.0.0.1"
  Set-KwipuDefaultEnv -Name "KWIPU_HTTP_PORT" -Value "8765"
  Set-KwipuDefaultEnv -Name "KWIPU_OLLAMA_HTTP" -Value "1"
  Set-KwipuDefaultEnv -Name "KWIPU_VERBOSE" -Value "1"
  Set-KwipuDefaultEnv -Name "KWIPU_NUM_CTX" -Value "32768"
  Set-KwipuDefaultEnv -Name "KWIPU_GRAPH_PATH_DEPTH" -Value "1"
  Set-KwipuDefaultEnv -Name "KWIPU_EMBED_BATCH_SIZE" -Value "1"
  Set-KwipuDefaultEnv -Name "KWIPU_EMBED_MAX_CHARS" -Value "4000"
  Set-KwipuDefaultEnv -Name "KWIPU_EXCLUDE_DIRS" -Value "00 rag storage;.obsidian;.git;node_modules"
  Set-KwipuDefaultEnv -Name "KWIPU_EXCLUDE_DIR_PREFIXES" -Value "00;01;02"
}

function Get-KwipuEndpoint {
  $hostName = Get-KwipuEnv -Name "KWIPU_HTTP_HOST" -Default "127.0.0.1"
  $port = Get-KwipuEnv -Name "KWIPU_HTTP_PORT" -Default "8765"
  "http://${hostName}:${port}"
}

function Copy-KwipuPluginFiles {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetDir
  )

  $root = Get-KwipuPluginRoot
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

  foreach ($file in @("manifest.json", "main.js", "styles.css", "README.md", "TODO.md", "package.json", ".env.example")) {
    Copy-Item -Path (Join-Path $root $file) -Destination (Join-Path $TargetDir $file) -Force
  }

  $targetScripts = Join-Path $TargetDir "scripts"
  New-Item -ItemType Directory -Force -Path $targetScripts | Out-Null
  Copy-Item -Path (Join-Path $root "scripts\*.ps1") -Destination $targetScripts -Force
}
