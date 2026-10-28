# Phase 4 Frontend Foundation and Authentication

> Historical record of this phase as it was built. Statements such as "no
> dataset has been selected" describe the project at that time; for the
> current system see [architecture](architecture.md) and
> [ML integration](ml-integration.md).
>
> Since v1.1.0, the sign-in, registration, and password pages use Firebase
> Authentication, and admins also enter an authenticator code. See
> [Authentication](authentication.md) for the current design.

## Scope

The frontend is a responsive React/Vite/TypeScript application. It is designed
desktop-first for regular PC browser use, with a compact mobile layout for
occasional smaller screens. Forms remain interactive at both sizes. This phase
implements auth screens and role entry points only; role dashboards and data
pages are Phase 5. No domain data fields or sample records are invented.

MUI is the sole component library. It provides accessible form controls, helper
text, loading/disabled states, buttons, alerts, and responsive primitives in
one consistent system. The visual layer uses Manrope, a restrained forest-green
and warm-coral identity, and a compact two-column PC auth shell that collapses
to a short brand header on small screens.

## Windows Setup

From the repository root, with Docker Desktop running:

```powershell
Push-Location frontend
npm ci
npm run dev
```

Open http://localhost:5173. The API must be running at http://localhost:8000 and
PostgreSQL must be healthy. In a second PowerShell terminal:

```powershell
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-proxy-headers
```

The browser can restore an existing Secure refresh cookie, but without the API
it remains signed out. API calls use VITE_API_URL from the shared root .env; the
default is http://localhost:8000. Keep the frontend and API hostname both
`localhost` so SameSite=Strict cookie behavior is consistent. Do not mix
`localhost` with `127.0.0.1` in browser URLs. The backend accepts cookie refresh
and logout only with Origin matching FRONTEND_URL, defaulting to
http://localhost:5173.

Refresh cookies are Secure even in development. Browsers generally treat
localhost as a secure context for this purpose; if your browser blocks the cookie,
use local HTTPS with a locally trusted certificate. Never disable certificate
validation or weaken cookie flags to work around that browser policy.

## Authentication Behavior

- The access token is kept in module memory and React state only; it is never
  stored in localStorage, sessionStorage, a cookie, or a URL.
- On startup, AuthProvider calls the refresh endpoint with credentials, stores
  the returned access token in memory, then calls GET /auth/me.
- The Axios client attaches the in-memory bearer token. On a 401 from a protected
  request, it performs at most one refresh request, shared across simultaneous
  failures, then retries the original request once. A failed refresh clears the
  token and signals AuthProvider to end the session.
- Login redirects admins to /admin, agents to /agent, and clients to /client.
  These role homes are temporary signed-in entry points; Phase 5 supplies their
  dashboards and layouts.
- Registration always calls the agent-only public registration endpoint. The
  role and pending status are assigned by the server. The pending page supports
  resending email verification.
- Email verification, forgot/reset password, and authenticated password change
  connect to the Phase 3 API. Password fields use server-aligned 12-128 character
  checks and display field-level validation, request errors, loading, and disabled
  states.
- The API client sends cookies with credentials and never reads the refresh
  cookie from JavaScript. Browser refresh/logout calls are restricted by the
  backend's trusted Origin check.

## Routes

| Route | Purpose |
| --- | --- |
| /login | Login and role-based redirect |
| /register | Agent self-registration |
| /registration-pending | Approval status and verification resend |
| /verify-email?token=... | Verify an email link |
| /resend-verification | Request another verification link |
| /forgot-password | Request a reset link |
| /reset-password?token=... | Set a replacement password |
| /change-password | Authenticated password update |
| /admin, /agent, /client | Protected role-specific temporary home |
| /403, /404 | Access denied and not found |

ProtectedRoute waits for session restoration before redirecting anonymous users.
RoleRoute prevents a signed-in user from rendering another role's route. The
backend independently enforces the same role boundary.

## UI and API Notes

Development email links target frontend routes on localhost:5173. API docs remain
at http://localhost:8000/docs. Swagger is not the app and does not establish the
browser's frontend Origin for refresh/logout. Use the frontend for cookie flows.

In Phase 5, the temporary role-home text is replaced with responsive sidebars,
top bars, account menus, and domain-dependent empty states after the approved
pages are added. The current project deliberately contains no dashboard mock
data.

## Checks

```powershell
Push-Location frontend
npm run lint
npm test
npm run build
npm run format:check
Pop-Location
```

Tests cover login validation/submission/loading, anonymous and wrong-role route
guards, role routes, one-time 401 refresh/retry, refresh failure logout signaling,
and refresh-cookie session restoration. Vitest runs with happy-dom. Production
build currently emits a Rollup chunk-size advisory because the single auth form
module imports MUI controls; it does not fail the build. Route-level code splitting
can be revisited as authenticated page modules grow in Phase 5.