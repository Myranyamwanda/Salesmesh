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
| POST /admin/model/reload | Admin | Reload and re-check the model; on failure the current model stays (409) |
| GET /admin/review-queue | Admin | Paginated flagged, unreviewed assessments, oldest first |
| GET /admin/assessments/{id} | Admin | Probability, threshold, flag, reasons, features, customer, agent, review |
| POST /admin/assessments/{id}/review | Admin | decision (`confirmed_real` or `confirmed_fake`), notes; once per assessment (409 after) |
| GET /admin/agents | Admin | Every agent with n_users, flags, assisted share, reputation, risk score, band; worst first |
| GET /admin/agents/{id} | Admin | One agent's figures and paginated customers with scores |
| PATCH /admin/agents/{id} | Admin | display_name and/or client_id (a client account, or null to unassign) |
| GET /admin/scoring-config | Admin | Reputation and rule settings |
| PUT /admin/scoring-config | Admin | p0, k, min_users_for_band, high_risk_below, watch_below, device_email_rule_min |
| POST /admin/customers/{id}/erase | Admin | confirm_email; deletes the customer, assessments, and reviews (204), audited as `customer_erased` without personal data; 422 if the email does not match |
| GET /admin/model/monitoring | Admin | p0 and, for the last 12 months, assessments, model flag rate, and mean probability (null for empty months) |

List endpoints accept `offset` (>= 0) and `limit` (1-100, default 25) and
return `items` and `total`. Admins cannot deactivate themselves or change their
own role, and the last active, verified admin cannot be removed.

Reviews, scoring-config changes, agent profile changes, and model reloads are
written to the audit log.

### Agent (`/me`)

| Method and Path | Access | Purpose |
| --- | --- | --- |
| GET /me/referral | Agent | referral_code, display_name, and the full `/join/<code>` link |
| GET /me/customers | Agent | Paginated customers: full_name, registered_at, assisted only |

Agents can see only their referral link and the list of customers they
onboarded. Reputation is an admin-only decision-support tool. A future
commission module may show payout status to agents.

### Client (`/client`)

| Method and Path | Access | Purpose |
| --- | --- | --- |
| GET /client/quality | Client | For the client's agents only: registrations, confirmed-fake count and percentage, registrations under review, and a 12-month trend of registrations and confirmed fakes. No model flags or scores. |

See [Reputation and review](reputation-and-review.md) for the rules.

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
