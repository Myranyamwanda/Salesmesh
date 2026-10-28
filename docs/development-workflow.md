# Development Workflow

## Prerequisites

Use Windows PowerShell, Git, Docker Desktop with Linux containers, Python 3.14,
Node.js 22.13 or newer, and npm. From the repository root, prepare the local
environment and generate the secrets (`JWT_SECRET` and `TOTP_ENCRYPTION_KEY`):

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
notepad .env
backend/.venv/Scripts/python.exe backend/manage.py init-secret
```

Set a unique PostgreSQL password, a `DEMO_PASSWORD`, and all six Firebase
variables in `.env` before starting the stack (see
[Firebase setup](authentication.md#firebase-setup-for-a-new-developer)), and
download the model files with `.\scripts\dev.ps1 fetch-model` (see the README
for the full clean-clone setup). To install the host frontend tools and Git hooks, run:

```powershell
Push-Location frontend
npm ci
Pop-Location
backend/.venv/Scripts/python.exe -m pre_commit install
```

The hooks run Ruff on Python changes (never on the Jupyter notebooks, which
are a research record), Prettier and ESLint when frontend files change, and
secret/large-file checks on staged files. `.gitattributes` keeps LF line endings
for all text files, and Prettier accepts either ending, so the hooks pass on a
Windows working copy too. Frontend checks require
`npm ci` to have been run in `frontend/`; the Compose frontend image installs
its own dependencies.

## Compose Services

Start the database, API, and Vite development server together:

```powershell
.\scripts\dev.ps1 up
```

The backend waits for PostgreSQL, applies Alembic migrations, then starts the
API. Open `http://localhost:5173`; the API is at `http://localhost:8000`. The
host PostgreSQL port remains configurable with `POSTGRES_PORT`. Containers use
the internal PostgreSQL port and bind application ports only to localhost.

Useful commands:

```powershell
.\scripts\dev.ps1 down
.\scripts\dev.ps1 migrate
.\scripts\dev.ps1 create-admin -Email you+admin@gmail.com
.\scripts\dev.ps1 reset-mfa -Email you+admin@gmail.com
.\scripts\dev.ps1 deactivate-user -Email old-admin@example.com
.\scripts\dev.ps1 fetch-model
.\scripts\dev.ps1 seed-demo
.\scripts\dev.ps1 reset-demo
.\scripts\dev.ps1 up-lan
.\scripts\dev.ps1 test
.\scripts\dev.ps1 lint
```

`create-admin` creates an admin in SalesMesh and Firebase and prints a
one-time set-password link; `reset-mfa` removes an admin's authenticator;
`deactivate-user` deactivates an account but never the last usable admin.
`fetch-model` downloads the model files and checks their SHA-256; `seed-demo`
and `reset-demo` create and remove the demo data, including the demo Firebase
accounts; `up-lan` makes the `/join` page reachable from a phone on the same
Wi-Fi (sign-in works only on `localhost`; see the README).

`down` preserves the named database volume. The first `test` run creates the
separate database named by `TEST_POSTGRES_DB`; tests run migrations and data
cleanup only against that disposable database. Never point it at the development
or production database. Tests never call Firebase or DNS: they use the
fakes in `backend/tests/conftest.py`.

To run the frontend checks directly on the host:

```powershell
Push-Location frontend
npm ci
npm run lint
npm test
npm run build
Pop-Location
```

`npm run format:check` checks the whole frontend; the pre-commit hook checks
only the staged frontend files.

## Continuous Integration

GitHub Actions runs backend and frontend workflows on pushes and pull requests
targeting `main` or `develop`. The backend job starts PostgreSQL 16, checks Ruff,
applies migrations, creates an isolated test database, and runs pytest. The
frontend job runs `npm ci`, lint, tests, and a production build. Model files
are not in Git, so the 4 tests that need the real model are skipped in CI; the
other model tests use a small model trained inside the tests. Dependabot
checks pip, npm, and GitHub Actions dependencies monthly against `develop`, and
never proposes scikit-learn, numpy, pandas, or joblib, because the saved model
needs those exact versions.

## GitHub Branch Protection

Configure these settings in GitHub after the workflows have run once so the
check names are available:

1. Open **Settings → Branches → Add branch protection rule** (or the repository
   rulesets page).
2. Set the branch name pattern to `main`.
3. Require a pull request before merging; require one approval if the repository
   has another reviewer available.
4. Require status checks before merging and select `backend` and `frontend`.
5. Require branches to be up to date before merging. For a solo repository,
   decide whether to allow administrators to bypass the rule so urgent fixes are
   still possible.
6. Save the rule. Repeat for `develop` if CI must also be required there.

GitHub owns branch protection settings; this repository cannot apply them from a
workflow file. The project workflow remains feature branches from `develop`,
with reviewed pull requests targeting `develop` and `main` reserved for releases.
