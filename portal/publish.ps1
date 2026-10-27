#!/usr/bin/env pwsh
# Builds the showcase, bundles it into the portal and publishes a self-contained folder to ./out
param(
    [string]$Runtime = 'linux-x64',
    [string]$Output = (Join-Path $PSScriptRoot 'out')
)
$ErrorActionPreference = 'Stop'
$showcase = Join-Path $PSScriptRoot '../showcase'
$target = Join-Path $PSScriptRoot 'wwwroot/showcase'

Push-Location $showcase
try {
    npm ci
    npm run build
} finally { Pop-Location }

Push-Location $PSScriptRoot
try { npm ci; npm run vendor } finally { Pop-Location }

if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Copy-Item (Join-Path $showcase 'dist') $target -Recurse

dotnet publish (Join-Path $PSScriptRoot 'Portal.csproj') -c Release -r $Runtime --self-contained false -o $Output
Write-Host "Published to $Output. Run it with: dotnet $Output/Portal.dll"
