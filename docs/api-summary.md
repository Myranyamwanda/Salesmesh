# API Summary

Base URL in development: `http://localhost:8000`. Interactive documentation
generated from the code is at `/docs` (Swagger UI) and `/openapi.json`. Request
and response bodies are JSON.

## Access Levels

| Access | Meaning |
| --- | --- |
| Public | No authentication |
| Bearer | `Authorization: Bearer <access token>` from login or refresh |
| Cookie + Origin | The `salesmesh_refresh` httpOnly cookie, plus an `Origin` header equal to `FRONTEND_URL` |
| Admin | Bearer token belonging to an active admin |

## Endpoints

### Health

| Method and Path | Access | Purpose |
| --- | --- | --- |
| GET /health | Public | Returns `status` (`ok` or `degraded`), `database`, `model` (`ok` or `failed`), and `model_error`; 503 only if PostgreSQL is unreachable |

### Authentication (`/auth`)

| Method and Path | Access | Body / Purpose |
| --- | --- | --- |
| POST /auth/register | Public | email, password, display_name; creates a pending agent with a referral code and sends a verification link |
| POST /auth/login | Public | email, password; returns an access token and sets the refresh cookie |
| POST /auth/refresh | Cookie + Origin | Rotates the refresh token and returns a new access token |
| POST /auth/logout | Cookie + Origin | Revokes the current session and clears the cookie; idempotent |
| POST /auth/logout-all | Bearer | Revokes all of the user's sessions and clears the cookie |
| GET /auth/me | Bearer | Current user (no password or token fields) |
| POST /auth/verify-email | Public | token; single-use, expiring |
| POST /auth/resend-verification | Public | email; replaces the previous verification token |
| POST /auth/forgot-password | Public | email; sends a single-use reset link |
| POST /auth/reset-password | Public | token, password; sets the password and revokes all sessions |
| POST /auth/change-password | Bearer | current_password, new_password; revokes all sessions |

### Public Registration (`/join`)

| Method and Path | Access | Body / Purpose |
| --- | --- | --- |
| GET /join/{code} | Public | The agent's `display_name` only |
| POST /join/{code}/register | Public (agent token for assisted mode) | Registration form plus `consent: true`, `session_length_minutes`, `device_id`, `user_agent`, and `assisted`; scores the customer and returns only `{"message": "Registration received"}` |

Both endpoints return the same 404 "This link is not active" for an unknown
code and for an agent who is not approved, active, and verified, or no longer
has the agent role. `assisted: true` requires the owning agent's access token
(otherwise 403). Non-assisted registrations are limited per IP address (429);
if the model is unavailable the endpoint returns 503 and saves nothing.

### Administration (`/admin`)

| Method and Path | Access | Body / Purpose |
| --- | --- | --- |
| GET /admin/users | Admin | Paginated user list |
| GET /admin/users/{id} | Admin | User detail |
| POST /admin/users | Admin | email, password, role (`admin` or `client`) |
| POST /admin/users/{id}/approve | Admin | Approve a pending agent |
| POST /admin/users/{id}/reject | Admin | Reject a pending agent |
| PATCH /admin/users/{id}/active | Admin | is_active boolean |
| PATCH /admin/users/{id}/role | Admin | role (`admin`, `agent`, or `client`) |
| GET /admin/audit-logs | Admin | Paginated audit entries (client-IP hashes are not returned) |
| GET /admin/model | Admin | Model status, version, metrics, threshold, and golden-check result |

List endpoints accept `offset` (>= 0) and `limit` (1-100, default 25) and
return `items` and `total`. Admins cannot deactivate themselves or change their
own role, and the last active, verified admin cannot be removed.

Agent, review, reputation, and client endpoints are added in the next phase.

## Responses

A user is returned as:

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "role": "admin | agent | client",
  "status": "pending | approved | rejected",
  "is_active": true,
  "email_verified_at": "2026-10-11T09:00:00Z or null",
  "created_at": "2026-10-11T09:00:00Z"
}
```

Login and refresh return `{"access_token": "...", "token_type": "bearer",
"expires_in": 900}`.

Every error uses the same envelope. HTTP errors use the code `http_<status>`
and validation failures use `validation_error`. Tokens are never included in
error details.
The `request_id` matches the `X-Request-ID` response header and the server log.

```json
{
  "error": {
    "code": "http_401",
    "message": "Authentication failed",
    "request_id": "uuid"
  }
}
```

| Status | When |
| --- | --- |
| 400 | Invalid or expired verification/reset token |
| 401 | Missing, invalid, expired, or revoked access token; failed login (with `WWW-Authenticate: Bearer`) |
| 403 | Authenticated with the wrong role, or refresh/logout from an untrusted Origin |
| 409 | Email already registered |
| 422 | Request body failed validation, including the password policy |
| 429 | Login rate limit exceeded (with `Retry-After`) |
| 503 | Database unavailable (`/health`) |
