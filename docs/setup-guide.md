# Setup Guide (Windows)

This guide starts from a fresh clone and ends with the full stack running, the
first admin signed in, and an agent registered and approved. Run every command
in PowerShell from the repository root unless a step says otherwise.

## 1. Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Git | any recent | `git --version` |
| Docker Desktop (Linux containers, Compose v2) | any recent | `docker compose version` |
| Python | 3.14 | `python --version` |
| Node.js and npm | 22.13 or newer | `node --version` |

Start Docker Desktop and wait until it reports that the engine is running.
Python is used on the host only to generate the JWT secret and run backend
tools; Node.js is needed only to run frontend checks outside Docker.

## 2. Clone

```powershell
git clone https://github.com/Myranyamwanda/Salesmesh.git
Set-Location Salesmesh
git switch develop
```

`main` holds released work and `develop` holds the latest integrated work.

## 3. Configure the Environment

```powershell
Copy-Item .env.example .env
notepad .env
```

In `.env`, replace `POSTGRES_PASSWORD` with a unique local password. If port
5432 is already used by another PostgreSQL install, set `POSTGRES_PORT` to a
free port such as `5433`. Every other value has a working development default
and is explained in `.env.example`. Never commit `.env`.

Create the backend virtual environment and generate the JWT signing secret:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python.exe backend/manage.py init-secret
```

`init-secret` writes a random `JWT_SECRET` into `.env` without printing it.

## 4. Start the Stack

```powershell
.\scripts\dev.ps1 up
```

This builds and starts PostgreSQL, the API, and the frontend, waits for their
health checks, and applies database migrations. When it finishes:

- Frontend: <http://localhost:5173>
- API documentation: <http://localhost:8000/docs>
- Health check: `Invoke-RestMethod http://localhost:8000/health`

## 5. Create the First Admin

```powershell
.\scripts\dev.ps1 create-admin -Email admin@example.com
```

Enter the password twice when prompted; it is not shown. It must be 12-128
characters with an uppercase letter, a lowercase letter, a digit, and a symbol.
This command works only while no admin exists. Further admins and clients are
created from **User Management** in the admin workspace.

Open <http://localhost:5173>, sign in, and you land on the admin overview.

## 6. Register and Approve an Agent

1. In a private browser window, open <http://localhost:5173/register> and
   register an agent. You are taken to the "registration pending" page.
2. Development emails are written to the API log instead of being sent. Find
   the verification link:

   ```powershell
   docker compose logs backend | Select-String "DEVELOPMENT EMAIL"
   ```

   Open the `link=` URL in the same private window to verify the email.
3. As the admin, open **User Management**, find the pending agent, and approve
   it.
4. Sign in as the agent. You land on the agent workspace. Visiting an admin
   page such as <http://localhost:5173/admin/users> shows the 403 page.

Clients are created by an admin in **User Management** and verify their email
the same way before signing in.

## 7. Run the Checks

```powershell
.\scripts\dev.ps1 test
.\scripts\dev.ps1 lint
Push-Location frontend
npm ci
npm test
npm run build
Pop-Location
```

`test` creates the separate `salesmesh_test` database on first use and runs the
backend tests against it, never against development data.

## 8. Day-to-Day Commands

| Command | Purpose |
| --- | --- |
| `.\scripts\dev.ps1 up` | Build and start all services |
| `.\scripts\dev.ps1 down` | Stop services; the database volume is kept |
| `.\scripts\dev.ps1 migrate` | Apply Alembic migrations in the running API container |
| `.\scripts\dev.ps1 create-admin -Email <address>` | Create the first admin |
| `.\scripts\dev.ps1 test` | Run backend tests |
| `.\scripts\dev.ps1 lint` | Run Ruff and ESLint |
| `docker compose logs -f backend` | Follow API logs, including development emails |

To delete all local data and start again, run `docker compose down -v`. This
removes the database volume permanently.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Missing .env` from `dev.ps1` | Run step 3 |
| `docker` is not recognised, or cannot connect to the engine | Start Docker Desktop and wait for it to finish starting |
| Port 5432 already allocated | Set `POSTGRES_PORT` in `.env` to a free port and run `up` again |
| API exits with a `JWT_SECRET` error | Run `backend/manage.py init-secret` (step 3), then `up` again |
| Sign-in fails for a new account | The account must be both approved and email-verified |
| Scripts are blocked by execution policy | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once |

For more detail see the [development workflow](development-workflow.md),
[backend authentication](backend-authentication.md), and
[frontend authentication](frontend-authentication.md) guides.
