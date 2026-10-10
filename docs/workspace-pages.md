# Phase 5 Workspace Pages

## Layouts and Routes

The authenticated app now uses role-specific workspace shells. Each has a
desktop sidebar, account top bar, profile and security links, responsive mobile
navigation, and a compact footer. RoleRoute still limits each route, while the
backend remains authoritative for API permissions.

Admin routes are `/admin`, `/admin/agents`, `/admin/agents/{id}`,
`/admin/review-queue`, `/admin/models`, `/admin/users`, `/admin/audit-log`, and
`/admin/settings`. Agent routes are `/agent` and `/agent/tasks`. Client routes
are `/client` and `/client/reports`. Shared authenticated routes include
`/profile` and `/change-password`; public `/403`, `/404`, and the router error
boundary remain available.

## Data Boundaries

Dataset-dependent dashboards, agent details, review queue, reports, model
management, and system settings remain empty-state pages. KPI cards, chart cards,
tables, filters, and a risk badge are reusable presentation components only.
They contain no sample agent, onboarding, metric, feature, or score data.

The admin user screen is fully backed by authentication tables: it lists and
filters accounts, creates admin/client accounts, resends verification, approves
or rejects pending agents, changes roles, and activates/deactivates users. The
backend rejects unsafe self-demotion/deactivation and remains the final access
control. New admin/client accounts need email verification; the development
sender prints the verification link to the backend terminal.

The audit screen reads paginated auth/audit events. It displays action, outcome,
user IDs, request ID, and time; it does not display client-IP hashes or any
password/token values. Both admin screens use the existing `/admin/users` and
`/admin/audit-logs` APIs and preserve backend pagination.

## Verification

From the repository root in PowerShell:

```powershell
Push-Location frontend
npm test
npm run lint
npm run build
npm run format:check
Pop-Location
```

UI tests cover admin account listing/approval/creation, audit rendering,
dataset-page empty states, and role navigation. The admin API test doubles are
local to the frontend test suite and do not alter PostgreSQL data.