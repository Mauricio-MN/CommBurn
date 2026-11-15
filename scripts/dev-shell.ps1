$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$toolRoot = Join-Path $projectRoot '.tools'
$nodeDir = Join-Path $toolRoot 'node'
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
    Write-Error 'Node.js local não foi configurado. Execute scripts\setup-local.cmd primeiro.'
    exit 1
}

$env:NODE_HOME = $nodeDir
$env:PATH = "$nodeDir;$env:PATH"
$env:npm_config_cache = Join-Path $toolRoot 'npm-cache'
$env:npm_config_devdir = Join-Path $toolRoot 'node-gyp'
$env:npm_config_prefix = Join-Path $toolRoot 'npm-global'
$env:npm_config_update_notifier = 'false'
Set-Location $projectRoot

Write-Host "CommBurn local: Node.js $(& (Join-Path $nodeDir 'node.exe') --version)"
Write-Host 'Comandos: npm test | npm start | npm run desktop'