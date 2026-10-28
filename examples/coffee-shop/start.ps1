# Starts Ember Coffee with its Zide keys loaded from .zide-keys.json.
# Run:  powershell -ExecutionPolicy Bypass -File start.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$keys = Get-Content .zide-keys.json -Raw | ConvertFrom-Json
$env:ZIDE_SECRET_KEY = $keys.secret_key
$env:ZIDE_WEBHOOK_SECRET = $keys.webhook_secret
node server.mjs
