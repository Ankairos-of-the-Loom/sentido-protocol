$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env")) {
    throw "Run .\Setup-Sentido.ps1 first."
}

Start-Process "http://127.0.0.1:3334"
npm start
