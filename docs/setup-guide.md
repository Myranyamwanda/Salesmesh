# Setup Walkthrough (Windows)

The complete clean-clone setup (prerequisites, `.env`, the JWT secret,
`fetch-model`, `up`, `migrate`, `create-admin`, `seed-demo`, checks, and
troubleshooting) is in the [README](../README.md#setup-from-a-clean-clone-windows).
This page continues from there: it walks through the main flows by hand.
Run commands in Windows PowerShell from the repository root.

## 1. Register and Approve an Agent

1. In a private browser window, open <http://localhost:5173/register> and
   register an agent with a display name. You are taken to the "registration
   pending" page.
2. Development emails are written to the API log instead of being sent. Find
   the verification link:

   ```powershell
   docker compose logs backend | Select-String "DEVELOPMENT EMAIL"
   ```

   Open the `link=` URL in the same private window to verify the email.
3. As the admin, open **User management**, find the pending agent, and approve
   it.
4. Sign in as the agent. The agent sees only **Referral link** and **My
   customers**. Visiting an admin page such as
   <http://localhost:5173/admin/users> shows the 403 page.

Clients are created by an admin in **User management** and verify their email
the same way. An admin assigns an agent to a client on the agent's detail page.

## 2. Register a Customer

1. As the agent, open **Referral link** and copy the link (or show the QR
   code).
2. In another private window, open the link. The page shows "Registering with
   <agent name>".
3. Fill in the form, tick the consent box (the "How we use your data" link
   explains the processing), and submit. The customer always sees
   "Registration received".
4. As the agent, **My customers** now lists the customer by name, date, and
   assisted flag only.

To register a customer on the agent's own device, open the link while signed
in as that agent and tick "I am registering this customer on my device".

## 3. Show the Device Rule

Register three different email addresses from the same browser on one `/join`
link. The third registration is flagged with a **Rule** reason ("This device
was used for 3 different email addresses in 8 weeks"). The rate limit allows
10 non-assisted registrations per network per hour.

## 4. Review a Flagged Registration

1. As the admin, open **Review queue** and click **Review** on a row. The
   dialog shows the probability, the reasons with their **Model** or **Rule**
   label, and the raw feature values.
2. Click **Confirm real** or **Confirm fake**, optionally with notes.
3. Open **Agents**: the agent's flags and reputation have changed at once, and
   **Audit log** shows the review.

**Erase customer data** in the same dialog deletes a customer on request after
the admin types the customer's email (see
[erasure requests](reputation-and-review.md#erasure-requests)).

## 5. Model and Client Views

- **Model** shows the version, test metrics, the golden check, monthly
  monitoring against p0, and **Reload model** (a failed reload keeps the
  current model).
- **Settings** edits the reputation and rule settings; reputations update at
  once.
- A client (for example `client1@demo.example.com` after `seed-demo`) sees
  registrations, confirmed fakes, and a 12-month trend for their own agents.

## 6. Day-to-Day Commands

| Command | Purpose |
| --- | --- |
| `.\scripts\dev.ps1 up` / `down` | Start or stop all services; the database volume is kept |
| `docker compose logs -f backend` | Follow API logs, including development emails |
| `.\scripts\dev.ps1 reset-demo` | Remove only the demo data |
| `docker compose down -v` | Delete all local data, including the database volume |

For more detail see the [development workflow](development-workflow.md),
[backend authentication](backend-authentication.md), and
[workspace pages](workspace-pages.md).
