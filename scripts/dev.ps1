param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("up", "down", "migrate", "create-admin", "test", "lint")]
    [string]$Command,
    [string]$Email
)

$ErrorActionPreference = "Stop"
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepositoryRoot

try {
    if (-not (Test-Path ".env")) {
        throw "Missing .env. Copy .env.example to .env and configure it first."
    }

    switch ($Command) {
        "up" {
            docker compose up --build --detach --wait
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            Write-Host "SalesMesh is running at http://localhost:5173 (API: http://localhost:8000)."
        }
        "down" {
            docker compose down
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        "migrate" {
            docker compose exec backend alembic upgrade head
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        "create-admin" {
            if ([string]::IsNullOrWhiteSpace($Email)) {
                throw "Pass -Email with the new administrator's email address."
            }
            docker compose exec backend python manage.py create-admin --email $Email
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
