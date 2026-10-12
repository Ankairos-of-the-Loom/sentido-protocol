$ErrorActionPreference = "Stop"

Write-Host "Sentido Protocol - local setup" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is not available. Install the current Node.js LTS release, close PowerShell, and run this script again."
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created private .env configuration." -ForegroundColor Green
} else {
    Write-Host "Existing .env preserved." -ForegroundColor Yellow
}

npm install
npm test
npm run validate

Write-Host ""
Write-Host "Setup passed." -ForegroundColor Green
Write-Host "Open .env in Notepad and add the API key, chosen model, and verified model prices."
Write-Host "Then run .\Start-Sentido.ps1"
