# Phase 3 Backend Authentication

## Scope and Decisions

Authentication users can be admins, agents, or clients. These are account roles,
not domain agent records. No dataset, onboarding, scoring, or ML fields are added.
The four authentication/audit tables remain the only application tables.

Argon2id is memory-hard and avoids bcrypt's password byte-length limit. Parameters
are 19 MiB memory, two iterations, and one lane, matching an OWASP-recommended
minimum configuration. Passwords require 12-128 characters with uppercase,
lowercase, a digit, and a non-whitespace symbol. Login verifies a dummy hash for
unknown accounts and returns the same failure response for incorrect credentials,
pending/rejected, unverified, inactive, or locked accounts.

Access tokens use HS256 with a generated signing secret, explicit issuer/audience,
and required expiry, user ID, role, session ID, and token-version claims. Secrets
are never printed by the setup command. Optional admin TOTP is deferred; this
phase does not claim to provide MFA.

## PowerShell Setup

From the repository root, keep Docker Desktop running and preserve the existing
database password and host port in .env. Install into the existing backend venv:

```powershell
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python.exe backend/manage.py init-secret
docker compose up -d --wait postgres
backend/.venv/Scripts/python.exe -m alembic -c backend/alembic.ini upgrade head
backend/.venv/Scripts/python.exe -m alembic -c backend/alembic.ini check
backend/.venv/Scripts/python.exe backend/manage.py create-admin --email admin@example.com
```

init-secret writes a cryptographically random JWT_SECRET to the ignored root
.env. It preserves existing values and never replaces an existing JWT_SECRET.
If a manually configured secret is too short or is a placeholder, replace it
locally with a generated secret before starting the API. Never paste it into chat
or commit it. All remaining auth settings have documented development defaults
in .env.example. Restart the server after changing settings.

create-admin prompts twice for a hidden password; it is not a command argument
or shell-history entry. It creates only the first admin, marks that bootstrap
account verified/approved, and records an audit event. Later admins/clients must
be created through authenticated admin endpoints and verify their emails. This
command requires migrated tables and does not bypass an existing admin account.

```powershell
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-proxy-headers
```

Inspect API documentation at http://localhost:8000/docs. No frontend exists yet,
so development email links point to routes that will be built in Phase 4. Use
the logged token with the corresponding POST endpoint to test verification or
reset now. Swagger's Authorize control accepts the access token for bearer-auth
endpoints. Browser-origin restrictions still apply to refresh/logout; Swagger
on the API origin is not the configured frontend origin.

## Cookie and Session Security

Refresh tokens are opaque random values. The database stores only SHA-256 hashes.
The cookie is always HttpOnly, Secure, SameSite=Strict, host-only, and scoped to
/auth; these attributes are not downgraded for development. Use HTTPS for cookie
flows with non-browser clients. Browsers may permit Secure cookies on localhost
HTTP as a local-development exception; do not rely on that for deployment.

For HTTPS, supply your locally trusted certificate and private key to Uvicorn
with --ssl-certfile and --ssl-keyfile. Keep certificates/private keys out of Git,
and do not disable TLS certificate verification. Use the same hostname for the
frontend and API (different ports are fine) so SameSite=Strict does not block
the cookie. Using localhost for the frontend and 127.0.0.1 for the API mixes sites.

Refresh and logout require an Origin header exactly matching FRONTEND_URL. This
prevents cookie-based CSRF; SameSite is an additional safeguard. Non-browser
clients must explicitly supply that header. Bearer tokens are not read from
cookies, query parameters, or local storage by the backend.

Each login creates a new session ID. Refresh revokes the old token, inserts its
replacement, and retains the original absolute session expiry. Row locks serialize
rotation. Reusing a revoked token revokes every token in that session, not other
sessions. Keep revoked rows until the session expires for replay detection.
Concurrent refresh calls using the same token cause this intentional revocation;
the future frontend must serialize refresh attempts.

/auth/me and role guards check current account state, token version, and an active
refresh-token session in the database. Logout therefore invalidates that session's
access tokens immediately rather than waiting for JWT expiry. Logout-all and
password changes/reset revoke every session. Admin role/activity/approval changes
also revoke affected sessions. Clients must discard their access token and sign
in again after a password change/reset.

## API Summary

All paths below are relative to the API host. Bodies are JSON. Errors use the
Phase 2 error envelope; tokens are never echoed in error details.

| Method and Path | Access | Body / Purpose |
| --- | --- | --- |
| POST /auth/register | Public | email, password; agent role and pending state are server-controlled |
| POST /auth/login | Public | email, password; access-token response plus refresh cookie |
| POST /auth/refresh | Cookie + trusted Origin | Rotate token and return a new access token |
| POST /auth/logout | Cookie + trusted Origin | Revoke session and clear cookie; idempotent |
| POST /auth/logout-all | Bearer | Revoke all sessions and clear cookie |
| GET /auth/me | Bearer | Current authentication user, with no password/token fields |
| POST /auth/verify-email | Public | token; single-use, expiring verification |
| POST /auth/resend-verification | Public | email; replace the previous verification token |
| POST /auth/forgot-password | Public | email; issue a single-use reset token |
| POST /auth/reset-password | Public | token, password; replace password and revoke sessions |
| POST /auth/change-password | Bearer | current_password, new_password |
| GET /admin/users | Admin | Paginated authentication-user list |
| GET /admin/users/{id} | Admin | Authentication-user detail |
| POST /admin/users | Admin | email, password, role (admin or client) |
| POST /admin/users/{id}/approve | Admin | Approve a pending agent account |
| POST /admin/users/{id}/reject | Admin | Reject a pending agent account |
| PATCH /admin/users/{id}/active | Admin | is_active boolean |
| PATCH /admin/users/{id}/role | Admin | role (admin, agent, client) |
| GET /admin/audit-logs | Admin | Paginated audit entries without client-IP hashes |

List endpoints accept offset >= 0 and limit 1-100, default 25. They return items
and total. Admins cannot deactivate themselves or change their own role; active,
verified admin retention is also checked under a shared database lock.
Duplicate registration or account creation returns HTTP 409. Public verification
and reset errors return HTTP 400. Missing, invalid, revoked, or expired access
tokens return HTTP 401 with WWW-Authenticate: Bearer. Wrong roles return HTTP 403.

## Verification, Recovery, and Development Email

Agent registration sends a verification link but does not grant access. Both
admin approval and verification are required before login. Email verification
stores one current hash/expiry on the user; resend invalidates the old token,
and successful verification clears it. Reset-token requests invalidate older
unused reset tokens. Both consumption paths use row locks and reject expiry/reuse.

Forgot-password and resend-verification return the same message for unknown or
ineligible emails. DevelopmentEmailSender deliberately logs complete links to
the console for local testing. Those links contain authentication secrets: keep
development logs private and do not use this sender in production. EmailSender
is a replaceable protocol exposed by get_email_sender; tests use a recording
sender. Replace it with a real provider before deployment. Delivery occurs after
database commit; if delivery fails, use the resend/request endpoint to retry.

## Brute-Force Protection and Audit

Login rate limiting is database-backed rather than process-local. An HMAC of
the connecting IP, keyed by JWT_SECRET, is stored on login audit rows; raw IPs
are not stored. A PostgreSQL advisory transaction lock serializes the limit across
workers. Successful and failed credential attempts both count. The default is
20 attempts per source per 60 seconds; excess requests return HTTP 429 with
Retry-After. Configure trusted proxy handling explicitly before deploying behind
a reverse proxy; do not trust arbitrary X-Forwarded-For values.

Five failed passwords lock the account for 15 minutes by default. Existing
lockouts are not extended by each failed retry. Successful login after expiry
clears failures; verified reset also clears lockout. Account locks serialize
failure-count updates. Other accounts do not share that account lockout.

Audit events include login success/failure, refresh/reuse, logout/logout-all,
registration, verification/recovery, password changes, bootstrap, user reads,
and admin user changes. Passwords, raw tokens, and request bodies are never stored
in audit logs. General request logs omit cookies, Authorization headers, and URLs.
Audit-table growth and recovery-email endpoint throttling must be addressed in
production operations before a public deployment.

## Verification Commands

The separate salesmesh_test database from Phase 2 is required. Do not point tests
at development data. Run from the repository root:

```powershell
backend/.venv/Scripts/python.exe -m pytest -c backend/pyproject.toml backend/tests -q
backend/.venv/Scripts/python.exe -m ruff check backend
backend/.venv/Scripts/python.exe -m ruff format --check backend
backend/.venv/Scripts/python.exe -m alembic -c backend/alembic.ini check
Invoke-RestMethod http://localhost:8000/health
```

The suite includes all authentication/admin flows, wrong-role 403, expired-token
401, token rotation and isolated-session replay detection, Secure cookie flags,
CSRF rejection, rate limits, lockout, password policy, secret-free audit entries,
and real concurrent refresh/reset/verification requests on separate PostgreSQL
connections. Concurrency tests clean up only their generated test accounts.

For manual testing: create the first admin, log in via /docs, register an agent,
verify the agent's token from the development email, approve the pending account
using admin bearer authorization, then log in as that agent. Use a client account
created by the admin and verify its email to confirm the client role. No agent or
client may access /admin endpoints. Frontend pages arrive in later phases.