# Starts the whole Zide demo in three windows: gateway API (:8080), website and hosted checkout
# (:5173) and the PrivateVPN example merchant (:4000).
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File tools\start-demo.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
# Deep project paths can break the MSVC linker (LNK1104), so build outside the project.
$env:CARGO_TARGET_DIR = Join-Path $env:USERPROFILE 'zide-target'

if (-not (Test-Path (Join-Path $root '.env'))) {
    throw "No .env in $root. Run: cargo run -p scanner -- keygen"
}
foreach ($port in 8080, 5173, 4000) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Close the old demo windows first."
    }
}

Write-Host 'Building gateway...'
Push-Location $root
& $cargo build -q -p gateway
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'gateway build failed' }
Pop-Location

$gateway = Join-Path $env:CARGO_TARGET_DIR 'debug\gateway.exe'
Start-Process powershell -WorkingDirectory $root -ArgumentList '-NoExit', '-Command',
    "`$Host.UI.RawUI.WindowTitle = 'Zide gateway'; & '$gateway'"

$web = Join-Path $root 'web'
if (-not (Test-Path (Join-Path $web 'node_modules'))) {
    Push-Location $web; npm install; Pop-Location
}
Start-Process powershell -WorkingDirectory $web -ArgumentList '-NoExit', '-Command',
    "`$Host.UI.RawUI.WindowTitle = 'Zide website'; npx vite --port 5173 --strictPort"

# The example merchant registers with the gateway on start, so wait until the gateway answers.
# It connects to the testnet server before listening, which can take a while.
Write-Host 'Waiting for the gateway...'
$deadline = (Get-Date).AddSeconds(90)
do {
    Start-Sleep -Seconds 1
    $up = $false
    try { $up = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8080/zide.js').StatusCode -eq 200 } catch {}
} until ($up -or (Get-Date) -gt $deadline)
if (-not $up) { throw 'The gateway did not start within 90 s. Check the "Zide gateway" window.' }
Start-Process powershell -WorkingDirectory $root -ArgumentList '-NoExit', '-Command',
    "`$Host.UI.RawUI.WindowTitle = 'PrivateVPN (example merchant)'; node examples/privatevpn/server.mjs"

Start-Sleep -Seconds 3
Start-Process 'http://localhost:5173/'
Start-Process 'http://localhost:4000/'
Write-Host 'Zide demo running: site http://localhost:5173 | demo app http://localhost:4000 | LP dashboard http://localhost:5173/#/lp'
