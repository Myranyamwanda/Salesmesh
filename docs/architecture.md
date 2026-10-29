# Architecture

SalesMesh is a three-tier web application: a React single-page app, a FastAPI
API, and a PostgreSQL 16 database. The API loads a trained scikit-learn model
once at startup and scores every customer registration with it. The model was
trained in the Jupyter notebooks in `ml/notebooks/`. Docker Compose runs the
three tiers together for development.

## System Overview

```mermaid
flowchart LR
    customer["Customer's phone<br/>/join/:code (public)"]
    browser["Browser<br/>React + MUI SPA<br/>admin, agent, client"]
    api["FastAPI API<br/>localhost:8000"]
    db[("PostgreSQL 16<br/>users, refresh tokens, MFA recovery<br/>codes, audit_logs, agent_profiles,<br/>client_profiles, customers,<br/>risk_assessments, reviews,<br/>scoring_config, model_versions")]
    firebase[["Firebase Authentication<br/>sign-in, verification and<br/>password emails"]]
    model["Model service<br/>model.joblib in memory"]
    files[["backend/models/v1/<br/>from GitHub Release model-v1<br/>(SHA-256 checked) or S3"]]
    notebooks["ml/notebooks/<br/>EDA → preprocessing → training →<br/>evaluation → export → simulation"]

    customer -->|"registration form"| api
    browser -- "JSON over HTTP<br/>Bearer access token" --> api
    browser -- "httpOnly refresh cookie<br/>(/auth only)" --> api
    browser -- "Firebase JS SDK<br/>(sign-in, Google)" --> firebase
    api -- "verify ID tokens,<br/>create/disable users" --> firebase
    api -- "SQLAlchemy sessions" --> db
    api --> model
    files -->|"loaded at startup:<br/>version + golden checks"| model
    notebooks -.->|"exported once"| files
```

The registration flow, step by step, is shown as a sequence diagram in
[ML integration](ml-integration.md#registration-flow).

## Backend Layers

```mermaid
flowchart TB
    routes["api/<br/>health, auth, admin, join, agent (/me),<br/>client, model, scoring_admin, kpis,<br/>integrations (/api/v1)"]
    deps["auth.py<br/>current user, require_roles(...)"]
    services["services/<br/>auth, firebase, mfa, email_checks, registration,<br/>scoring, reviews, reputation, pipeline, eligibility,<br/>kpis, standing, erasure, agents, audit, geoip"]
    ml["ml/<br/>model_service, features, explain"]
    core["core/<br/>settings, security, errors, logging"]
    models["models/ + schemas/<br/>SQLAlchemy tables, Pydantic I/O"]
    db["db/<br/>engine and session factory"]

    routes --> deps
    routes --> services
    deps --> services
    services --> ml
    services --> models
    services --> core
    models --> db
```

Routes stay thin: they validate input with Pydantic schemas and call a service
function. Services hold the rules (scoring, review decisions, reputation,
token rotation, admin MFA), so they can be tested without HTTP. All calls to
Firebase go through `services/firebase.py`, which tests replace with a fake. `ml/` contains
everything that knows about the model: loading and checking it, building the
13 features from a registration, and explaining a score. Keeping all settings
in one `Settings` class means every configurable value is read from `.env` and
documented in `.env.example`.

## Frontend Structure

```mermaid
flowchart TB
    main["main.tsx<br/>QueryClient + AuthProvider + Router"]
    routes["routes/<br/>ProtectedRoute, RoleRoute"]
    layouts["layouts/<br/>AuthLayout, WorkspaceLayout, PublicLayout"]
    pages["pages/<br/>auth, admin/, agent/, client/, JoinPage<br/>(loaded on demand)"]
    components["components/<br/>tables, badges, review and erase dialogs,<br/>monitoring card"]
    api["api/<br/>axios client with refresh-and-retry"]
    auth["auth/<br/>access token held in memory,<br/>Firebase client (firebase.ts)"]

    main --> routes --> layouts --> pages
    pages --> components
    pages --> api
    api --> auth
```

Each role has its own workspace (`/admin`, `/agent`, `/client`), and customers
use the public `/join/:code` page. Every page is loaded with `React.lazy`, so a
user downloads only the pages they open.

## Runtime Environments

| Environment | How it runs | Database |
| --- | --- | --- |
| Compose development | `.\scripts\dev.ps1 up` builds and starts all three services; the API applies migrations on start; `backend/models` is mounted read-only | `postgres_data` named volume |
| LAN development | `.\scripts\dev.ps1 up-lan` adds `docker-compose.lan.yml` so a phone on the same Wi-Fi can open the app | Same volume |
| Host development | Uvicorn from `backend/.venv` and `npm run dev` in `frontend/` | Compose PostgreSQL on `POSTGRES_PORT` |
| Tests | pytest against a separate database ending in `_test`; a small model trained in the tests stands in for the real one | `TEST_POSTGRES_DB` |
| CI | GitHub Actions `backend` and `frontend` workflows; the 4 real-model tests are skipped because model files are not in Git | PostgreSQL 16 service container |

## Key Decisions

- **Synchronous SQLAlchemy.** Simpler to read and test than async; FastAPI runs
  sync routes in a thread pool, which is sufficient at this scale.
- **Access token in memory, refresh token in an httpOnly cookie.** JavaScript
  cannot read the long-lived token, which limits damage from XSS; the short
  access token is lost on reload and restored through the cookie.
- **The model is loaded once and checked before use.** A version check and 20
  golden examples run at startup; on failure the API stays up, reports
  `model: failed`, and refuses to score, rather than serving wrong scores.
- **Model plus transparent rules.** Features are clipped to the training range
  before the model sees them, and a rule catches extreme values; every reason
  says whether it came from the model or a rule.
- **Human review for every flag.** At about 9% precision most flags are
  genuine customers, so the model only routes registrations to a person.
- **Reputation is calculated on read.** There is no reputation table, so a
  reputation can never be out of date after a registration, review, setting
  change, or erasure.
- **Least privilege per role.** Only admins see model output. Agents see
  their referral link, customer names, a monthly standing label, and monthly
  totals, and clients see only confirmed outcomes, so the scores cannot be
  gamed or misread.
- **Statuses and KPIs are derived, not stored.** The registration status,
  commission eligibility, monthly KPIs, and reputation at a past month end are
  all computed from the assessments and reviews, so they always agree with
  each other and with the live reputation (a test checks the current month).
- **Coarse, delayed views outside the admin role.** Agents see a monthly
  standing label and monthly totals; clients see pending registrations only
  as a total. Neither can work out which customers were flagged.
- **Versioned integration API.** `/api/v1` is a separate router whose fields
  are only ever added, so other modules can rely on it; it is rate-limited
  from the audit log, which works with several API workers.
- **Model files outside Git.** Binaries are downloaded from a GitHub Release
  and verified with SHA-256 checksums that are tracked in Git.
