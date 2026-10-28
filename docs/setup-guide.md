# Setup Walkthrough (Windows)

The complete clean-clone setup (prerequisites, `.env`, the JWT secret,
`fetch-model`, `up`, `migrate`, `create-admin`, `seed-demo`, checks, and
troubleshooting) is in the [README](../README.md#setup-from-a-clean-clone-windows).
This page continues from there: it walks through the main flows by hand.
Run commands in Windows PowerShell from the repository root.

## 1. Register and Approve an Agent

1. In a private browser window, open <http://localhost:5173/register> and
   create an account with a real address you can read (a Gmail plus-address
   such as `you+agent1@gmail.com` works), or use **Sign up with Google**.
2. For an email and password account, Firebase sends a verification email
   (check the spam folder). Open its link, return to the page, and press
   **I have verified my email**. Google accounts skip this step.
3. Enter a display name and press **Request agent access**. You are taken to
   the "review queue" page. Disposable addresses, and domains without a mail
   server, are refused with "Use a permanent email address".
4. As the admin, open **User management**, find the pending agent, and approve
   it.
5. Sign in as the agent. The agent sees only **Referral link** and **My
   customers**. Visiting an admin page such as
   <http://localhost:5173/admin/users> shows the 403 page.

Clients (and other admins) are created by an admin in **User management**
without a password: Firebase emails them a link to set one, and they can also
use Google sign-in with the same address. Admins also set up an authenticator
app at their first sign-in. An admin assigns an agent to a client on the
agent's detail page. See [Authentication](authentication.md) for every flow.

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
