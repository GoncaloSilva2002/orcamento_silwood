$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$releaseDir = Join-Path $root "dist\silwood-orcamentos-windows"
$exePath = Join-Path $root "dist\silwood-orcamentos.exe"

Set-Location $root

function Invoke-Checked {
  param(
    [string]$Command,
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Comando falhou: $Command $($Arguments -join ' ')"
  }
}

if (Test-Path $releaseDir) {
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}

if (Test-Path $exePath) {
  Remove-Item -LiteralPath $exePath -Force
}

if (!(Test-Path "node_modules\pkg\package.json")) {
  Invoke-Checked "npm.cmd" @("install")
}

Invoke-Checked "npm.cmd" @("run", "build:exe")

if (!(Test-Path $exePath)) {
  $foundExe = Get-ChildItem -Path (Join-Path $root "dist") -Filter "*.exe" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($foundExe) {
    $exePath = $foundExe.FullName
  } else {
    throw "O pkg terminou sem criar o executavel em dist\silwood-orcamentos.exe. Verifica as mensagens acima."
  }
}

New-Item -ItemType Directory -Path $releaseDir | Out-Null
Copy-Item -LiteralPath $exePath -Destination (Join-Path $releaseDir "silwood-orcamentos.exe")
Copy-Item -LiteralPath (Join-Path $root "public") -Destination $releaseDir -Recurse
Copy-Item -LiteralPath (Join-Path $root "data") -Destination $releaseDir -Recurse
Copy-Item -LiteralPath (Join-Path $root "scripts") -Destination $releaseDir -Recurse
Copy-Item -LiteralPath (Join-Path $root "config") -Destination $releaseDir -Recurse
Copy-Item -LiteralPath (Join-Path $root ".env.example") -Destination (Join-Path $releaseDir ".env.example")

Write-Host ""
Write-Host "Build criado em:"
Write-Host $releaseDir
Write-Host ""
Write-Host "No servidor, copia esta pasta, cria o ficheiro .env e executa:"
Write-Host ".\silwood-orcamentos.exe"
