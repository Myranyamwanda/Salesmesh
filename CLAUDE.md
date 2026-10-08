# SalesMesh Project Rules

## Context

SalesMesh is a distributed sales-agent onboarding platform and a final-year
capstone project. The developer's contribution is an AI engine that detects
fraudulent agent behaviour and assigns risk and reputation scores from 0 to 100.
Development follows Agile Scrum with a solo developer.

No dataset has been selected and the data fields are unknown. Do not design
database tables, columns, features, or API fields for agents, onboardings,
metrics, or scores. Build authentication, structure, and empty-state pages only.
Authentication users may have the admin, agent, or client role; those roles do
not imply a domain agent model. Defer the domain data model until the developer
provides the dataset and approves its design.

## Stack and Environment

- Frontend: React, Vite, and TypeScript.
- Backend: FastAPI, pydantic-settings, SQLAlchemy 2.0, and Alembic.
- Database: PostgreSQL; use the explicitly requested postgres:16 container.
- Development and automation: Docker Compose and GitHub Actions.
- Local machine: Windows with PowerShell. Commands and scripts must work in
  PowerShell; do not depend on make or Bash-only scripts.
- Use current stable package versions when adding dependencies. Verify package
  names and APIs rather than inventing them. Do not install dependencies for
  phases that have not been approved.

## Working Rules

- The Git repository already exists. main and develop have been pushed to
  GitHub. Never reinitialise Git or create another remote repository.
- Start each phase on feature/<phase-name> from develop. Preserve existing work.
- Make small Conventional Commits using feat:, fix:, chore:, docs:, test:, or ci:.
- Do not add "Co-Authored-By" lines or "Generated with Claude Code" text to
  commit messages or pull requests.
- At the end of each phase, STOP. Provide a short summary, PowerShell
  verification commands, and manual steps. Wait for approval before merging
  into develop or starting the next phase. Do not push without approval.
- Never commit secrets. Document every configurable setting in .env.example
  using placeholders or clearly labelled non-secret development defaults.
  Keep local .env files, datasets, and generated model artifacts out of Git.
- Keep code simple, readable, professionally organised, and explainable to
  examiners. Explain decision trade-offs in one or two sentences.
- Do not revert unrelated changes. Do not introduce domain schemas or fake
  scoring functionality to fill the unknown dataset requirements.
- Satisfy the assessment requirements: a development environment, organised
  code, Git version control, prepared databases/APIs/files as applicable, and
  appropriate workflow and development automation.

## Approved Phase Boundaries

### Phase 1: Structure and Development Environment

Create frontend/; backend/app/{api,core,db,models,schemas,services,ml};
backend/alembic/; backend/tests/; ml/{notebooks,src,artifacts}; data/; docs/;
and .github/. Use tracked placeholders for empty directories.
Add .gitignore, .env.example, .editorconfig, this file, and docker-compose.yml
with PostgreSQL 16, environment settings, a named volume, and a healthcheck.
Do not scaffold the applications or create database tables in this phase.

### Phase 2: Backend Foundation

Add FastAPI with environment settings, database sessions, and Alembic.
GET /health must check the database connection. Tables are restricted to users,
refresh tokens or sessions, password reset tokens, and audit logs. Plan email
verification storage within the authentication scope; add no domain tables.
Provide consistent error responses, CORS for the frontend URL only, structured
logging, Ruff lint/format, and pytest using a separate test database.

### Phase 3: Backend Authentication

- Use Argon2 or bcrypt password hashing and explain the choice. Enforce a
  password policy with a minimum length and appropriate checks.
- Login returns a short-lived JWT access token containing user ID and role.
  Store the long-lived refresh token in an httpOnly, Secure, SameSite cookie.
- Rotate refresh tokens, revoke the old token on refresh, detect revoked-token
  reuse, and revoke the entire affected session on reuse.
- Support logout, logout of all sessions, and GET /auth/me.
- Allow agent self-registration with pending status until admin approval.
- Admins can create clients/admins, approve/reject agents, activate/deactivate
  users, and change roles.
- Provide email verification, forgot/reset password, single-use expiring
  tokens, and a replaceable email service that logs development emails.
- Changing a password requires the current password.
- Add login rate limiting, account lockout after repeated failures, and
  require_roles(...) role-based access control.
- Audit login success/failure, logout, password changes, and all admin actions
  on users. Do not log passwords or raw authentication tokens in audit logs.
- Add a terminal command for creating the first admin.
- Test every flow, including wrong-role 403 and expired-token 401 responses.
- Optional admin TOTP multi-factor authentication comes last, only if simple.

### Phase 4: Frontend Foundation and Authentication

Use react-router-dom, @tanstack/react-query, axios, react-hook-form, zod,
recharts, and MUI as the single UI library; explain the MUI choice.
Organise src/ into api/, auth/, components/, layouts/, pages/, routes/, hooks/,
types/, and utils/.
AuthProvider holds the access token in memory only and restores sessions using
the refresh cookie. On a 401, the axios interceptor refreshes once and retries
the request; refresh failure logs the user out. Add ProtectedRoute, RoleRoute,
and role-specific post-login navigation.
Provide Login, Agent Registration, Registration Pending, Verify Email,
Forgot Password, Reset Password, and Change Password pages with validation,
clear errors, and loading/disabled submit states. Add ESLint, Prettier, and
Vitest tests for route guards and the login form.

### Phase 5: Layouts and Pages

Build responsive admin, agent, and client layouts with sidebars and top bars
with user menus. Shared pages: My Profile / Account Settings, 403, 404, and a
general error boundary.
Admin pages: Overview Dashboard, Agents List, Agent Detail, Review Queue,
Model Management, User Management, Audit Log, and System Settings.
User Management and Audit Log must work using the authentication tables.
Agent pages: My Dashboard and My Onboarding Tasks.
Client pages: Client Dashboard and Onboarding Reports.
For dataset-dependent pages, provide titles, layouts, reusable KPI cards,
data tables, chart cards, risk badges, filters, and clear empty states such as
"No data yet - the scoring model is not connected". Do not invent data fields.
Only if necessary, put layout sample content in one clearly named, removable
frontend mock file.

### Phase 6: Automation

Add pre-commit hooks for Ruff, Prettier, ESLint, check-added-large-files, and
detect-private-key. Add backend.yml and frontend.yml workflows on pushes and
pull requests to main/develop. Backend checks: PostgreSQL service, Ruff,
alembic upgrade head, and pytest. Frontend checks: npm ci, lint, test, build.
Configure Dependabot for pip, npm, and github-actions; add User story and Bug
issue templates and a pull request template.
Extend Compose with backend/frontend services for one-command startup.
Provide scripts/dev.ps1 commands: up, down, migrate, create-admin, test, lint.
List manual GitHub steps for main branch protection and required status checks.

### Phase 7: ML Placeholder and Documentation

Add a scoring interface with a placeholder implementation and TODO in
backend/app/ml/; do not define features. Document placeholder modules in
ml/src/ for data loading, feature engineering, training, evaluation, and export.
The eventual output contract is a saved model file and metadata JSON containing
feature names, model version, threshold, and metrics; actual features and
metrics remain undecided.
Document architecture and authentication with Mermaid diagrams, API summary,
and a setup guide. Complete README with description, architecture,
prerequisites, Windows setup, commands, structure, branches, and commits.
Validate from a clean clone: startup, migrations, initial admin login, agent
registration/approval, all tests passing, and role-restricted pages.