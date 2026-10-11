# SalesMesh

Distributed sales-agent onboarding capstone project. The planned AI engine will
detect fraudulent behaviour and assign risk and reputation scores from 0 to 100.
No dataset or domain data model has been selected; no scoring is implemented.

## Current Progress

- Phase 1: repository structure and PostgreSQL 16 development environment.
- Phase 2: FastAPI foundation, authentication/audit-only storage, Alembic,
  database health checks, structured logging, and PostgreSQL-backed tests.
- Phase 3: secure authentication, refresh rotation/reuse detection, account
  verification/recovery, admin controls, rate limiting, and audit logging.
- Phase 4: responsive React authentication UI and role-protected routes.
- Phase 5: responsive role workspaces, profile/security, and admin account and
  audit pages. Dataset-dependent views remain explicit empty states.
- Phase 6: Docker development services, pre-commit checks, CI, and GitHub
  workflow templates.

## Setup

Use Windows PowerShell, Git, Docker Desktop with Linux containers, Python 3.14,
and Node.js 22.13 or newer. Copy `.env.example` to `.env`, configure the local
PostgreSQL password, and generate the JWT signing secret before startup.

- [Development environment](docs/development-environment.md)
- [Backend setup and verification](docs/backend-foundation.md)
- [Frontend setup and authentication flows](docs/frontend-authentication.md)
- [Development workflow and CI](docs/development-workflow.md)
- [Workspace pages](docs/workspace-pages.md)

Start PostgreSQL, the API, and the frontend together with
`.\scripts\dev.ps1 up`. Compose applies migrations before starting the API.
The workflow guide lists test, lint, migration, admin-creation, and teardown
commands.

The backend exposes `GET /health` and interactive API documentation at `/docs`.
Outside Compose, apply Alembic migrations explicitly before startup.

## Workflow

Start each phase on `feature/<phase-name>` from `develop`. Use Conventional
Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`). Phase pull requests
target `develop`, not `main`. See [project rules](CLAUDE.md).
