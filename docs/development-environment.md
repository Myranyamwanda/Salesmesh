# Phase 1 Development Environment

## Scope

This phase prepares the folder structure and local PostgreSQL only. Backend,
frontend, authentication, migrations, and ML implementation come in later
approved phases. No domain data model or dataset has been selected.

## Prerequisites

- Git and PowerShell.
- Docker Desktop with Docker Compose v2 and Linux containers enabled.
  Follow Docker Desktop's Windows requirements, including WSL 2 where needed.
- Python and Node.js/npm for later phases. Dependency versions and supported
  runtimes will be checked when the applications are added.

Docker must be running before the database commands below will work.

## Local Setup

Run commands from the repository root in PowerShell. Copy the template only
when .env does not already exist:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Replace POSTGRES_PASSWORD with a unique local password. POSTGRES_DB and
POSTGRES_USER are non-secret development defaults; POSTGRES_PORT defaults to
5432. If another database uses that port, choose an unused local port in .env.
Use single quotes around values containing literal dollar signs or hash marks
so Compose does not interpolate them. Never commit .env.

```powershell
docker compose version
docker compose config --quiet
docker compose up -d --wait postgres
docker compose ps
docker compose exec postgres psql -U salesmesh_dev -d salesmesh -c "SELECT 1;"
```

The last command uses the template's database/user defaults; substitute your
values if you changed them in .env. The database should be healthy and the
query should return 1. These commands need no Bash installation on Windows.
Use `config --quiet` rather than printing the resolved configuration, which
includes your database password.

## Stop and Inspect

```powershell
docker compose logs --tail 50 postgres
docker compose down
```

The named postgres_data volume retains database contents when containers stop.
Do not use `docker compose down --volumes` unless you intend to delete local
database contents. PostgreSQL's initial database/user/password settings apply
when the volume is first initialised; changing .env does not update credentials
in an existing volume.

## Decisions

- PostgreSQL 16 is explicitly required. The major-version image tag receives
  patch updates, trading byte-for-byte reproducibility for maintenance updates.
- The port binds to 127.0.0.1 for host development access without exposing the
  database on every network interface. The named volume provides persistence.
- .gitkeep files retain empty directories. Datasets and model artifacts are
  ignored, with exceptions only for their tracked placeholders.
- EditorConfig uses LF line endings across platforms. PowerShell supports LF;
  existing unrelated files are not reformatted.