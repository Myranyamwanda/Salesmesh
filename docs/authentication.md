# Authentication Overview

This page shows the authentication flows as diagrams. Security details and
settings are in [backend authentication](backend-authentication.md) and
[frontend authentication](frontend-authentication.md); endpoints are listed in
the [API summary](api-summary.md).

## Roles and Account Lifecycle

Accounts have one role: `admin`, `agent`, or `client`. These are login roles
only, not domain records. Agents register themselves; admins create clients and
other admins. The first admin is created from the terminal.

```mermaid
stateDiagram-v2
    [*] --> Pending: agent registers (POST /auth/register)
    Pending --> Approved: admin approves
    Pending --> Rejected: admin rejects
    Approved --> CanLogIn: email verified
    CanLogIn --> Inactive: admin deactivates
    Inactive --> CanLogIn: admin reactivates
    Rejected --> [*]

    state "Approved, email not verified" as Approved
    state "Approved and verified (can log in)" as CanLogIn
```

Approval and email verification can happen in either order; both are required
before login. Admin-created accounts start approved but must still verify
their email.

## Login

```mermaid
sequenceDiagram
    actor User
    participant SPA as React app
    participant API as FastAPI
    participant DB as PostgreSQL

    User->>SPA: email + password
    SPA->>API: POST /auth/login
    API->>DB: check rate limit and lockout
    API->>DB: load user, verify Argon2id hash
    alt credentials valid and account allowed
        API->>DB: store SHA-256 hash of new refresh token (new session ID)
        API->>DB: audit login_success
        API-->>SPA: 200 access token (15 min JWT: user ID, role, session)<br/>Set-Cookie refresh token (httpOnly, Secure, SameSite=Strict, path=/auth)
        SPA->>SPA: keep access token in memory only
        SPA-->>User: redirect to /admin, /agent, or /client
    else invalid, pending, unverified, inactive, or locked
        API->>DB: audit login_failure, count failed attempt
        API-->>SPA: 401 generic error (same for every reason)
    end
```

## Refresh Rotation and Reuse Detection

```mermaid
sequenceDiagram
    participant SPA as React app
    participant API as FastAPI
    participant DB as PostgreSQL

    SPA->>API: GET /admin/users (expired access token)
    API-->>SPA: 401
    SPA->>API: POST /auth/refresh (cookie + Origin header)
    API->>DB: lock refresh-token row
    alt token active
        API->>DB: revoke old token, insert replacement in same session
        API-->>SPA: new access token + new cookie
        SPA->>API: retry GET /admin/users once
        API-->>SPA: 200
    else token already revoked (replayed)
        API->>DB: revoke every token in that session
        API->>DB: audit refresh_reuse
        API-->>SPA: 401
        SPA->>SPA: clear session and go to /login
    end
```

The frontend sends only one refresh request at a time, because two concurrent
refreshes with the same token would look like reuse and end the session.

## Email Verification and Password Reset

```mermaid
sequenceDiagram
    actor User
    participant SPA as React app
    participant API as FastAPI
    participant Mail as Email service

    User->>SPA: request (register / forgot password)
    SPA->>API: POST /auth/register or /auth/forgot-password
    API->>API: create single-use token, store only its hash with expiry
    API->>Mail: send link containing the raw token
    Note over Mail: development sender writes the link to the backend log
    User->>SPA: open link (/verify-email or /reset-password)
    SPA->>API: POST /auth/verify-email or /auth/reset-password
    API->>API: lock row, reject expired or used token, mark used
    API-->>SPA: 200 (reset also revokes all sessions)
```

## Authorisation

Protected routes use `require_roles(...)`. It checks the JWT signature and
expiry, then reloads the user so deactivation, role changes, and logout take
effect immediately.

| Situation | Response |
| --- | --- |
| No token, bad signature, expired, or revoked session | 401 |
| Valid token, wrong role (for example an agent calling `/admin/users`) | 403 |

On the frontend, `ProtectedRoute` sends signed-out users to `/login` and
`RoleRoute` sends users with the wrong role to `/403`.
