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
- Frontend, automation, and ML are reserved for later
	approved phases.

## Setup

Use Windows PowerShell, Git, Docker Desktop with Linux containers, and Python
3.14 (the verified runtime). Frontend setup is deferred.

- [Development environment](docs/development-environment.md)
- [Backend setup and verification](docs/backend-foundation.md)
- [Authentication setup and API](docs/backend-authentication.md)

After installing dependencies, generate the local signing secret and apply
migrations before startup. The authentication guide includes the first-admin
command and explains Secure-cookie requirements.

The backend exposes GET /health and interactive API documentation at /docs.
It does not create tables at startup; apply Alembic migrations explicitly.

## Workflow

Start each phase on feature/<phase-name> from develop. Use Conventional Commits
(feat:, fix:, chore:, docs:, test:, ci:). Review phase changes in a pull request
targeting develop, not main. Merging, pushing, and moving to the next phase each
require approval. See [project rules](CLAUDE.md).
