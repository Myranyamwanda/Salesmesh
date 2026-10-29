# Workspace Pages

The frontend has one public page for customers and a workspace for each role.
Every page reads real data from the API through TanStack Query; there is no
sample or mock data. RoleRoute limits each route on the client, and the backend
remains the authority for every permission.

## Routes

| Route | Who | Page |
| --- | --- | --- |
| `/join/:code` | Public | Customer registration through an agent's referral link |
| `/admin` | Admin | Overview: model status, reviews waiting, agent counts, agents needing attention |
| `/admin/review-queue` | Admin | Flagged registrations with reasons; review dialog |
| `/admin/agents` | Admin | Agents ranking, sortable and filterable by band |
| `/admin/agents/:agentId` | Admin | Agent figures, profile and client assignment, customers |
| `/admin/models` | Admin | Model version, metrics, threshold, golden check, reload |
| `/admin/settings` | Admin | Reputation and rule settings |
| `/admin/users`, `/admin/audit-log` | Admin | User management and audit log |
| `/agent` | Agent | Referral link with share buttons and QR code |
| `/agent/customers` | Agent | My customers |
| `/client` | Client | Registration quality dashboard |
| `/profile`, `/change-password` | Signed in | Account pages; the password is changed in Firebase (Google accounts change it in Google) |
| `/login`, `/register`, `/forgot-password`, `/registration-pending` | Public | Firebase sign-in (password or Google), agent sign-up, Firebase reset email, and the approval waiting page. Admins enter or set up their authenticator code inside the sign-in page |

## Public Join Page

`PublicLayout` is a single, mobile-first column without the sidebar, built for
phones from 320 px wide up to laptops. The page:

- shows "You are registering for {client name} with agent {display name}",
  or a friendly "This link is not active. Contact your agent." page for any
  unknown or inactive link (including an agent without a named, active
  client);
- collects only the fields the model needs (see
  [ML model service](ml-scoring.md)), with the country as a short East African
  list plus a few others, defaulting to Kenya;
- requires a consent checkbox under the Kenya Data Protection Act 2019, next to
  a "How we use your data" dialog: the data is used for registration and fraud
  prevention and shared with the named client for onboarding (consent version
  2), SalesMesh administrators also see it, the agent sees only the name and
  registration date, and
  the customer can ask for access or deletion at `VITE_PRIVACY_CONTACT_EMAIL`;
- sends the minutes from opening the form to submitting it, a random device ID
  kept in `localStorage` (missing if storage is blocked), and the browser user
  agent;
- offers "I am registering this customer on my device" only to the signed-in
  agent who owns the link;
- shows the same neutral "Registration received" message and a reference
  number whatever the score.

## Agent Area

Agents can see only their referral link and the list of customers they
onboarded. Reputation is an admin-only decision-support tool. A future
commission module may show payout status to agents.

- **Referral link:** copy the link; share it by WhatsApp (`wa.me`), SMS
  (`sms:`), or email (`mailto:`); show a large QR code; download the QR code as
  a PNG; or open the link on this device for an assisted registration. All
  sharing happens on the agent's device; the server sends no messages. The QR
  code is drawn in the browser by `qrcode.react`.
- **My customers:** name, registration date, and whether it was registered on
  the agent's device. No status, score, or reasons.

## Admin Area

- **Review queue:** probability, threshold, and the top reasons. Each reason has
  a **Model** or **Rule** label. The review dialog shows the customer, all
  reasons, and the raw feature values, and records "Confirm real" or "Confirm
  fake" with optional notes.
- **Agents ranking:** customers, flags, confirmed fake, pending, assisted share,
  reputation, risk score, band, and client, sorted lowest reputation first.
- **Agent detail:** the same figures, the display name, the client assignment,
  a **Reputation at month end** line chart and a **Monthly KPIs** table for
  the last 12 months, and the agent's customers with their reference,
  registration status, eligibility, and probability.
- **Commission eligibility:** eligible, pending, and not-eligible totals, a
  table per registration month (newest first), and a table per agent for all
  time or one month. Agent detail also shows each customer's eligibility.
- **Model:** status, version, scikit-learn version, threshold, test metrics,
  and the golden check. "Reload model" keeps the current model if the new one
  fails its checks. A **Monitoring** card charts the monthly model flag rate
  and mean probability against p0, with a table of the same figures.
- **Erase customer data:** in the review dialog, with a typed-email
  confirmation and warnings for confirmed-fake or pending customers (see
  [Reputation and review](reputation-and-review.md#erasure-requests)).
- **Settings:** the six scoring settings, each with a short explanation and the
  same validation as the backend.
- **Audit log:** now also shows each entry's subject, such as
  `assessment:<id>`.

- **Overview:** besides the model, review, and attention cards, a **Network
  flag rate** line chart, the network KPIs by month, and the flag-rate
  benchmark of each agent against the network.

KPI charts are single-series Recharts lines in the dataviz reference palette's
first categorical colour (`#2a78d6`, validated on white). Months without data
are gaps, not zeros, and every chart has a table with the same figures.

## Client Area

The quality dashboard shows registrations, confirmed fake %, and the number
of registrations under review for the client's own agents, with a 12-month
chart (Recharts) and the same figures in a table. A **Commission eligibility**
section shows eligible and not-eligible registrations per agent and the
number awaiting verification as a single total. Clients see only outcomes a person has confirmed, never model flags or scores. At the model's precision about 9 in 10 flagged registrations are genuine, so a "flagged %" would overstate fraud and could unfairly harm an agent's standing with their client.

## Accessibility

Band badges (High risk, Watch, Low risk, Insufficient data), reason sources
(Model, Rule), and customer statuses always show a text label, so their meaning
never depends on colour alone. Filter dropdowns are linked to their visible
label for screen readers.

## Tests

Vitest tests in `frontend/src` cover the join page (agent name, inactive link,
consent, privacy dialog, payload, assisted mode, rate-limit message), the
referral card (share links, copy, QR dialog, PNG download), My customers
(columns only), the review queue (Model/Rule labels, review decision, error),
the agents ranking (sorting, band badges, filter), agent detail (client
assignment), the model page (golden check, failed reload), settings (help
text, validation, payload), the client dashboard, and each role's sidebar.

```powershell
Push-Location frontend
npm test
npm run lint
npm run build
Pop-Location
```
