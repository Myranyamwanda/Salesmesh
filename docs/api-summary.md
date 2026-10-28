# API Summary

Base URL in development: `http://localhost:8000`. Interactive documentation
generated from the code is at `/docs` (Swagger UI) and `/openapi.json`. Request
and response bodies are JSON.

## Access Levels

| Access | Meaning |
| --- | --- |
| Public | No authentication |
| Bearer | `Authorization: Bearer <access token>` from sign-in or refresh |
| Cookie + Origin | The `salesmesh_refresh` httpOnly cookie, plus an `Origin` header equal to `FRONTEND_URL` |
| MFA token | The `mfa_token` from `/auth/firebase`, sent in the body (admins only, 5 minutes) |
| Admin | Bearer token belonging to an active admin |

## Endpoints

### Health

| Method and Path | Access | Purpose |
| --- | --- | --- |
| GET /health | Public | Returns `status` (`ok` or `degraded`), `database`, `model` (`ok` or `failed`), and `model_error`; 503 only if PostgreSQL is unreachable |

### Authentication (`/auth`)

| Method and Path | Access | Body / Purpose |
| --- | --- | --- |
| POST /auth/firebase | Public | id_token (Firebase ID token, verified email); agents and clients get an access token and the refresh cookie; admins get `{mfa: "setup" or "verify", mfa_token, expires_in}` instead |
| POST /auth/mfa/setup | MFA token | mfa_token; returns `secret` and `otpauth_uri` for the authenticator app (admins without one) |
| POST /auth/mfa/setup/confirm | MFA token | mfa_token, code; turns TOTP on, returns the tokens plus 10 `recovery_codes` (shown once), sets the refresh cookie |
| POST /auth/mfa/verify | MFA token | mfa_token, code (6-digit TOTP or a recovery code); returns an access token and sets the refresh cookie |
| POST /auth/firebase/register | Public | id_token, display_name; creates a pending agent with a referral code (agents only; real-email checks apply) |
| POST /auth/refresh | Cookie + Origin | Rotates the refresh token and returns a new access token |
| POST /auth/logout | Cookie + Origin | Revokes the current session and clears the cookie; idempotent |
| POST /auth/logout-all | Bearer | Revokes all of the user's sessions and clears the cookie |
| GET /auth/me | Bearer | Current user (no token fields) |

Passwords, email verification, and password resets are handled by Firebase in
the browser; SalesMesh has no password endpoints. The MFA token is a 5-minute
token from `/auth/firebase`, not an access token. See
[Authentication](authentication.md) for the flows.

### Public Registration (`/join`)

| Method and Path | Access | Body / Purpose |
| --- | --- | --- |
| GET /join/{code} | Public | The agent's `display_name` only |
| POST /join/{code}/register | Public (agent token for assisted mode) | Registration form plus `consent: true`, `session_length_minutes`, `device_id`, `user_agent`, and `assisted`; scores the customer and returns only `{"message": "Registration received"}` |

Both endpoints return the same 404 "This link is not active" for an unknown
code and for an agent who is not approved, active, and verified, or no longer
has the agent role. `assisted: true` requires the owning agent's access token
(otherwise 403). Non-assisted registrations are limited per IP address (429).
A disposable address, or a domain without a mail server, gets 422
`email_not_permanent` ("Use a permanent email address"); if the model is
unavailable the endpoint returns 503 and saves nothing.

### Administration (`/admin`)

| Method and Path | Access | Body / Purpose |
| --- | --- | --- |
| GET /admin/users | Admin | Paginated user list |
| GET /admin/users/{id} | Admin | User detail |
| POST /admin/users | Admin | email, role (`admin` or `client`); creates the user in SalesMesh and Firebase without a password (the browser then sends Firebase's "set your password" email) |
| POST /admin/users/{id}/password-email | Admin | Makes sure the user has a Firebase account (creates and links one without a password if missing) so the browser can then send Firebase's password email; 409 for an inactive or conflicting account |
| POST /admin/users/{id}/approve | Admin | Approve a pending agent |
| POST /admin/users/{id}/reject | Admin | Reject a pending agent |
| PATCH /admin/users/{id}/active | Admin | is_active boolean; also disables or enables the Firebase user and revokes its Firebase sessions |
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
own role, and an admin cannot be deactivated or demoted if no other usable
admin (active, verified, linked to Firebase, with an authenticator) would
remain (409).

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
  "firebase_linked": true,
  "created_at": "2026-10-11T09:00:00Z"
}
```

Sign-in and refresh return `{"access_token": "...", "token_type": "bearer",
"expires_in": 900}`.

Every error uses the same envelope. HTTP errors use the code `http_<status>`,
validation failures use `validation_error`, and sign-in errors the frontend
must tell apart use a stable code, such as `email_not_verified`,
`account_not_found`, `account_pending`, `account_inactive`,
`account_link_conflict`, `account_exists`, `email_not_permanent`,
`mfa_invalid_code`, `mfa_locked`, `mfa_session_expired`, and
`mfa_not_configured` (the full list is in [Authentication](authentication.md)).
Tokens are never included in error details.
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
| 401 | Missing, invalid, expired, or revoked access or Firebase token (with `WWW-Authenticate: Bearer`); wrong or expired MFA code or MFA token |
| 403 | Wrong role; refresh/logout from an untrusted Origin; email not verified, account pending, or account inactive at sign-in |
| 404 | No SalesMesh account for a verified Firebase email (`account_not_found`) |
| 409 | Email already registered; account linked to another Firebase user; last usable admin |
| 422 | Request body failed validation, or the email cannot receive mail (`email_not_permanent`) |
| 429 | Sign-in rate limit exceeded, or too many wrong MFA codes (with `Retry-After`) |
| 503 | Database unavailable (`/health`); Firebase not configured or unreachable; `TOTP_ENCRYPTION_KEY` missing |
