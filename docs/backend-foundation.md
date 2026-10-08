# Phase 2 Backend Foundation

## Scope

This phase adds FastAPI, environment settings, PostgreSQL sessions, migrations,
database health checks, consistent errors, JSON logging, and backend tests.
Authentication endpoints and password hashing belong to Phase 3. No dataset,
domain agent model, onboarding model, features, or scoring fields are defined.

## Windows Setup

Run these PowerShell commands from the repository root. Docker Desktop must be
running with Linux containers. Python 3.14 is the verified local runtime.

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Keep the existing password and port when updating an existing .env. Compare it
with .env.example for new settings; the backend defaults cover Phase 2 additions.
If port 5432 is occupied, set POSTGRES_PORT=5433 in .env. Do not change the
container's internal port. No virtual-environment activation or execution-policy
change is required.

```powershell
docker compose config --quiet
docker compose up -d --wait postgres
backend/.venv/Scripts/python.exe -m alembic -c backend/alembic.ini upgrade head
backend/.venv/Scripts/python.exe -m alembic -c backend/alembic.ini check
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Leave the server terminal running. In another PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Start-Process http://127.0.0.1:8000/docs
```

The health response is `{"status":"ok","database":"ok"}` only after a successful
SELECT 1 query. Database unavailability returns HTTP 503 without connection
details. Use Ctrl+C to stop the server. `docker compose down` stops PostgreSQL
without deleting its named volume.

## Settings

Environment variables override the root .env file. Database passwords use
SecretStr and SQLAlchemy URL construction, not string interpolation, so special
characters do not break connection URLs. Never print resolved Compose settings
or commit .env.

| Setting | Purpose |
| --- | --- |
| POSTGRES_DB | Development database name |
| POSTGRES_USER | Database username |
| POSTGRES_PASSWORD | Local password; replace the template placeholder |
| POSTGRES_PORT | Host port exposed by Compose; also used by the Windows backend |
| POSTGRES_HOST | Backend database host; default 127.0.0.1 |
| FRONTEND_URL | One permitted CORS origin; default http://localhost:5173 |
| LOG_LEVEL | DEBUG, INFO, WARNING, ERROR, or CRITICAL; default INFO |
| DB_CONNECT_TIMEOUT | Connection timeout in seconds; default 5 |
| TEST_POSTGRES_DB | Separate disposable test database; default salesmesh_test |

Host, port, reload mode, and worker count are Uvicorn command-line options rather
than extra application settings. This phase runs the backend on Windows; Compose
backend/frontend services are deferred to Phase 6.

## Authentication-Only Storage

| Table | Purpose |
| --- | --- |
| users | Login identity, role, approval/activity state, lockout state, verification state |
| refresh_tokens | Hashed refresh tokens, expiry/revocation, and a shared session ID |
| password_reset_tokens | Hashed single-use reset tokens, expiry, and consumption time |
| audit_logs | Actor/target user references, action, outcome, request ID, and timestamp |

Alembic also maintains its own alembic_version bookkeeping table.

An authentication user with the agent role is not a domain agent record. Agent
accounts will start pending; approval and email verification will be enforced by
Phase 3 services. User email addresses must be normalized to lowercase before
insertion. Email verification reserves one current token hash and expiry on the
user; replacing or consuming it will invalidate the old token. No raw tokens
are stored.

Refresh-token rows sharing a session ID will support rotation and whole-session
revocation. Revoked rows must be retained until the session expires so reuse can
be detected. The user token version reserves password-change and account-change
invalidation for Phase 3. These are storage contracts, not implemented auth flows.

Deleting a user removes their token rows but preserves audit records with null
user references. Audit storage intentionally has no arbitrary request-body or
metadata field to discourage recording passwords or authentication tokens.

## Tests and Checks

Create the dedicated test database once. These commands use the template's user
and test database name; substitute your values if you changed them in .env.

```powershell
docker compose exec postgres createdb -U salesmesh_dev salesmesh_test
backend/.venv/Scripts/python.exe -m pytest -c backend/pyproject.toml backend/tests -q
backend/.venv/Scripts/python.exe -m ruff check backend
backend/.venv/Scripts/python.exe -m ruff format --check backend
```

If createdb reports that the database already exists, do not recreate or delete
it; proceed to pytest. Tests connect to TEST_POSTGRES_DB, never POSTGRES_DB. The
name must differ from development and end in _test. Use only a disposable test
database: the migration round-trip test drops and recreates its authentication
tables. Test migrations use an explicitly supplied connection rather than
overwriting production settings. Each data test uses an outer transaction and
savepoints so even application commits are rolled back afterwards. Do not run
multiple test suites concurrently against the same test database.

Coverage includes healthy/failed database checks, HTTP 404/422/500 envelopes,
HTTP error headers, CORS, secret-safe logging/settings, schema scope, unique email,
role/status constraints, foreign keys, deletion behavior, test database guards,
and migration upgrade/downgrade/model alignment.

## Error and Logging Contract

Application errors follow this shape:

```json
{"error":{"code":"database_unavailable","message":"Database is unavailable","request_id":"uuid"}}
```

The server generates X-Request-ID values for correlation. Validation errors do
not echo submitted values. Unexpected errors return a generic message. CORS wraps
the application so the configured frontend can also read error responses.
Browser preflight rejection remains the middleware's standard HTTP 400 response.

JSON logs contain timestamp, level, logger, event, and selected request metadata.
Request logs omit bodies, cookies, Authorization headers, URL paths, and query
strings. Uvicorn's access logger is disabled to avoid logging verification/reset
tokens in URLs. Exception text is not included in application error logs.

## Decisions

- Synchronous SQLAlchemy sessions keep the foundation simple; FastAPI runs sync
  endpoints in its thread pool. Async access can be evaluated if measured load
  warrants it later.
- Dependencies are pinned to verified stable PyPI versions. SQLAlchemy remains
  on the latest 2.0 release to honor the requested stack rather than moving to 2.1.
- The test database shares the local PostgreSQL server but not its database.
  This tests PostgreSQL behavior without introducing SQLite differences.