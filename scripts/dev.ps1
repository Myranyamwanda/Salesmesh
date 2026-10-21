param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("up", "up-lan", "down", "migrate", "create-admin", "reset-mfa", "deactivate-user", "fetch-model", "seed-demo", "reset-demo", "test", "lint")]
    [string]$Command,
    [string]$Email
)

$ErrorActionPreference = "Stop"
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepositoryRoot

try {
    if ($Command -eq "fetch-model") {
        # Needs no .env: it only downloads and verifies the model files.
        & (Join-Path $PSScriptRoot "fetch-model.ps1")
        exit 0
    }
    if (-not (Test-Path ".env")) {
        throw "Missing .env. Copy .env.example to .env and configure it first."
    }

    switch ($Command) {
        "up" {
            docker compose up --build --detach --wait
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            Write-Host "SalesMesh is running at http://localhost:5173 (API: http://localhost:8000)."
        }
        "up-lan" {
            # Development only: let a phone on the same Wi-Fi open the app.
            $LanIp = Get-NetIPConfiguration |
                Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } |
                Select-Object -First 1 -ExpandProperty IPv4Address |
                Select-Object -First 1 -ExpandProperty IPAddress
            if (-not $LanIp) {
                throw "No network connection found. Connect this computer to Wi-Fi first."
            }
            $env:LAN_IP = $LanIp
            docker compose -f docker-compose.yml -f docker-compose.lan.yml up --build --detach --wait
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            Write-Host "SalesMesh is on your network at http://${LanIp}:5173 (API: http://${LanIp}:8000)."
            Write-Host "Open that address on this computer too; localhost will not work in this mode."
            Write-Host "Your phone must be on the same Wi-Fi. Run '.\scripts\dev.ps1 up' to return to localhost."
            if ((Get-NetConnectionProfile | Select-Object -First 1).NetworkCategory -eq "Public") {
                Write-Warning "Windows marks this network as Public, so the firewall may block your phone. See README: 'Testing on a phone'."
            }
        }
        "down" {
            docker compose down
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        "migrate" {
            docker compose exec backend alembic upgrade head
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        { $_ -in "create-admin", "reset-mfa", "deactivate-user" } {
            # create-admin: new admin in SalesMesh and Firebase; prints a set-password link.
            # reset-mfa: removes an admin's authenticator app (lost phone).
            # deactivate-user: keeps the account for audit history; never the last usable admin.
            if ([string]::IsNullOrWhiteSpace($Email)) {
                throw "Pass -Email with the account's email address."
            }
            docker compose exec backend python manage.py $Command --email $Email
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        "seed-demo" {
            # Demo accounts use @demo.example.com and DEMO_PASSWORD from .env.
            docker compose exec backend python manage.py seed-demo
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        "reset-demo" {
            # Deletes only demo users and the customers of demo agents.
            docker compose exec backend python manage.py reset-demo
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        "test" {
            $CreateTestDatabase = docker compose exec --no-TTY postgres sh -c 'createdb -U "$POSTGRES_USER" "$TEST_POSTGRES_DB" 2>&1'
            if ($LASTEXITCODE -ne 0 -and ($CreateTestDatabase -notmatch "already exists")) {
                throw $CreateTestDatabase
            }
            docker compose exec backend pytest -c pyproject.toml tests -q
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        "lint" {
            docker compose exec backend ruff check app tests
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            docker compose exec backend ruff format --check app tests
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            docker compose exec frontend npm run lint
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
    }
}
finally {
    Pop-Location
}
