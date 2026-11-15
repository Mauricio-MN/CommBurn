$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$toolRoot = Join-Path $projectRoot '.tools'
$nodeVersion = 'v22.23.5'
$nodeDir = Join-Path $toolRoot 'node'
$nodeExecutable = Join-Path $nodeDir 'node.exe'

if (-not (Test-Path $nodeExecutable)) {
    if (Test-Path $nodeDir) {
        throw "A pasta '$nodeDir' já existe, mas não contém node.exe. Renomeie-a ou remova-a e execute novamente."
    }

    New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
    $archiveName = "node-$nodeVersion-win-x64.zip"
    $archivePath = Join-Path $toolRoot $archiveName
    $releaseUrl = "https://nodejs.org/dist/$nodeVersion"
    $checksums = Invoke-WebRequest -Uri "$releaseUrl/SHASUMS256.txt" -UseBasicParsing
    $checksumMatch = [regex]::Match($checksums.Content, "(?m)^([a-fA-F0-9]{64})\s+$([regex]::Escape($archiveName))\s*$")
    if (-not $checksumMatch.Success) {
        throw "Não foi possível encontrar o SHA-256 oficial de $archiveName."
    }

    Invoke-WebRequest -Uri "$releaseUrl/$archiveName" -OutFile $archivePath -UseBasicParsing
    $actualChecksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ($actualChecksum -ne $checksumMatch.Groups[1].Value) {
        Remove-Item -LiteralPath $archivePath -Force
        throw "O SHA-256 de $archiveName não corresponde ao publicado pelo Node.js."
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $toolRoot -Force
    $extractedDir = Join-Path $toolRoot "node-$nodeVersion-win-x64"
    if (-not (Test-Path (Join-Path $extractedDir 'node.exe'))) {
        throw 'O arquivo do Node.js foi extraído sem node.exe.'
    }

    Move-Item -LiteralPath $extractedDir -Destination $nodeDir
    Remove-Item -LiteralPath $archivePath -Force
}

$env:NODE_HOME = $nodeDir
$env:PATH = "$nodeDir;$env:PATH"
$env:npm_config_cache = Join-Path $toolRoot 'npm-cache'
$env:npm_config_devdir = Join-Path $toolRoot 'node-gyp'
$env:npm_config_prefix = Join-Path $toolRoot 'npm-global'
$env:npm_config_update_notifier = 'false'

$npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $npmCli)) {
    throw "npm não foi encontrado dentro da distribuição portátil em '$nodeDir'."
}

Write-Host "Node.js $nodeVersion instalado em .tools\node"
Write-Host 'Instalando as dependências locais com npm ci...'
Push-Location $projectRoot
try {
    & $nodeExecutable $npmCli ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci terminou com código $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

Write-Host 'Ambiente pronto. Execute scripts\dev-shell.cmd para abrir o terminal do projeto.'