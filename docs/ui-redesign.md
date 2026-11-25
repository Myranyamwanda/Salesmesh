# UI Redesign (v1.4.0): Tables, Forms, and Identity

Supervisor feedback on v1.3.0: tables and forms looked plain and crowded.
This document is the design direction. Phase 0 applies it to one table
(Agents) and one form (Sign in); Phase 1 applies it to every list.

It builds on the design tokens in `frontend/src/tokens.ts` (see
[workspace-pages.md](workspace-pages.md#design-tokens)). Phase 0 adds three
tokens: `warningTint`, `errorTint` (badge fills), `fieldBorder` (form field
outline, 3:1 on white for WCAG 1.4.11) and nothing else; colours, fonts, and
radii are unchanged.

## Electric Direction (Step 3, chosen from a style board)

The developer compared three directions on a temporary, dev-only style board
(Savanna, Electric, Bright; removed before merge) and chose **Electric**:
indigo and violet primary with lime and cyan accents.

- **Gradients only on hero areas:** the sign-in panel, the `/join` header,
  the Overview hero, and the KPI card edges. Tables, forms, drawers, and page
  backgrounds stay on light surfaces. "Needs attention" became a light card.
- **Sign in, sign up, password reset:** the new mesh logo (four connected
  nodes) and "SalesMesh" wordmark, the unchanged message "Every connection
  starts here." / "A secure workspace for teams, agents, and clients.", a
  stylised dashboard preview (decorative, hidden from screen readers, in
  normal flow so it cannot overlap text), and the form in a card. The small
  eyebrow and footer labels were removed.
- **`/join`:** a gradient header with the client and agent, numbered steps
  (current step filled and bold, `aria-current="step"`), and a light form.
  The submitted fields and the session timer are unchanged.
- **Tables:** at most six columns, a tinted header, a 4 px band edge plus a
  band badge with an icon and text, tinted initials avatars, and the pager.
  A table card's `overflow: hidden` made it the sticky container, so the
  sticky header slid over the first row; it is now `overflow: clip`.
- **KPI cards:** each KPI has its own colour (indigo, lime, cyan, violet), a
  tinted icon chip, a gradient area or bar chart with a text summary for
  screen readers, and a trend chip such as "+12% vs last month" (arrow icon
  plus words; a count instead of a percentage when the previous month is 0).
- **Contrast:** every text colour pair is at least 4.5:1; colour is never
  the only signal (bands, steps, and trends all carry text).

Screenshots: `docs/screenshots/v1.4.0/identity/` (`after-identity-*` and the
list pages), regenerated with `SCREENSHOT_SET=after`,
`SCREENSHOT_FORMAT=jpeg`, `SCREENSHOT_DIR=../docs/screenshots/v1.4.0/identity`.

### Sign-in polish (Step 4)

A pass to remove generic "template" signals from the sign-in, sign-up,
password-reset, and `/join` header screens.

- **Palette (solid colours only):** night `#15123a` (brand panel, `/join`
  header, Overview hero), indigo `#4f46e5` (actions and links), lime
  `#bef264` and cyan `#67e8f9` (mesh nodes), flag red `#f43f5e` (one node),
  white `#ffffff` with ink `#1b1748` (form side). No gradient washes or glows
  anywhere in the app; KPI cards keep a solid top edge in their own colour.
- **Type:** one family, Bricolage Grotesque (variable weight and optical
  size, self-hosted via Fontsource), with tabular figures on by default.
  Scale: 13 / 14 / 16 / 18 / 32 / 56 px (`typeScale` in `tokens.ts`).
- **Layout:** solid night panel with the logo, the kept message, and the
  Kenya mesh; the form sits directly on white, left-aligned, with labels
  above the fields on sign in, sign up, and reset. No card, no shadow, no
  arrow on the main button, no filler subtitle under "Sign in".
- **The one bold element:** `KenyaMesh`, an original SVG of agent nodes and
  links tracing a simplified outline of Kenya. About a second after load one
  node turns red with a single ring (a flagged agent), then settles. No
  motion with `prefers-reduced-motion`; hidden from screen readers. On
  narrow screens it sits beside the message in the top band.
- **Removed:** the stylised dashboard preview, the two-tone wordmark, the
  `/join` background arcs, and the floating header card on `/join`.

### Final polish (Step 5)

- Sign-in form centred in the white side; Chrome autofill painted the field
  colour so the whole field (including the show-password button) matches.
- Kenya mesh: one node colour, a clearer outline and fainter inner links,
  larger and anchored to the panel's bottom-right; only the flagged node
  turns red, once.
- Google button neutral grey; only "Sign in" is indigo.
- Font: the Latin file is preloaded and a local Arial scaled to Bricolage's
  measured metrics (`size-adjust` 93.11%, ascent 99.88%, descent 29%) is the
  fallback; measured layout shift on sign-in with a delayed font: 0.0025.
- One set of hover, pressed, and focus-visible states for buttons, inputs,
  table rows, tabs, and navigation items.
- A 180 ms fade on route changes and after sign-in (`RouteFade`), no
  movement; off with `prefers-reduced-motion`.
- Skeletons while a page loads and for the Overview KPI values; the sign-in
  spinner sits in a fixed slot so the button keeps its size.
- Three corner radii (8, 12, 20 px, plus full rounding for circles and pills)
  and one shadow (`--card-shadow`, also every MUI elevation).

## Phase 1b Identity Proposal (Step 1)

This proposal applies the new visual identity only to Sign in, admin Overview,
the Agents table and drawer, and customer registration at `/join`. The shared
table and pagination, drawers, permissions, API contracts, and accessibility
behavior remain in place. Other screens are unchanged until Step 2 is approved.

### Identity rules

| Element             | Rule                                                                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand palette       | SalesMesh blue `#2a55d4`, deep blue `#173c9c`, teal `#137b68`, amber `#f5b84b`, ink `#14213d`, and line `#dce5ef`.                                                                                                                                                                              |
| Gradients           | Dark navy/blue/teal on the original mesh sign-in artwork and the Overview attention panel; light blue-to-mint on join and drawer cards; blue-to-teal on primary actions. White text on the tested sign-in gradient endpoints measures 6.50:1 and 5.32:1; the attention-panel sample is 10.27:1. |
| Illustrations       | Original inline SVG network nodes and connecting lines only. No stock images or third-party logos.                                                                                                                                                                                              |
| Empty states        | The proposal's Agents list uses the original mesh SVG for no-agent and no-search-match states; Step 2 extends this illustration to every shared `ListTable` empty state. Text and controls remain explicit.                                                                                     |
| Avatars             | Initials use a stable name/ID hash into five high-contrast color pairs. An agent's stable ID is preferred when available, so changing a display name does not recolor the avatar.                                                                                                               |
| Risk bands          | A narrow row/card edge uses High risk `#b4232f`, Watch `#a76505`, Low risk `#147a5a`, or Insufficient data `#53627a`. The existing text badge remains beside it; color is never the only status cue.                                                                                            |
| Scores and trends   | Reputation is a compact radial gauge with its numeric value as text, plus a six-month sparkline with a screen-reader label. The drawer uses a larger gauge and trend.                                                                                                                           |
| Motion              | Short card-hover and drawer transitions, and a 220 ms step fade/slide. `prefers-reduced-motion` suppresses identity motion and the global reduced-motion rule disables animations. Focus remains visible on new controls.                                                                       |
| Responsive behavior | The existing table changes to cards on narrow screens. `/join` is mobile-first; the split sign-in panel becomes a stacked brand panel and form. The 360 px check remains in the browser accessibility suite.                                                                                    |

The `/join` desktop canvas uses a wider 900 px white surface over the original
mesh-dot and network-ring background. Step 1 and address fields use a two-column
layout on desktop; the 360 px and 390 px layouts remain single-column. The
creative background is CSS-only, contains no third-party artwork, and is hidden
by the existing reduced-motion behavior through static presentation.

Model probability was not rendered in the proposal: the Agents list and drawer
have no per-registration probability in their existing API data. Adding or
aggregating that value here would expand the contract and misrepresent an
agent-level score. Step 2 uses the existing per-registration probability only
in the admin Review queue.

### `/join` flow and unchanged behavior

The form now has three steps—About you, Where you live, and Review and consent—
with Back/Continue actions and a progress indicator. The client's organization
and referring agent are named in the header and trust card. Consent remains
explicit and unchecked by default. Back navigation retains fields in component
memory only; it does not persist data to local storage.

- The mobile input keeps the existing `mobile_phone` payload and displays a
  fixed `+254` prefix with the numeric keyboard. A local `071...` number is
  normalized to `+25471...` on submit.
- Address duration uses years/months selectors and still sends the existing
  month counts. Email typo suggestions are opt-in; they never rewrite the
  entered address automatically. Existing schema validation and server-side
  MX email checks are unchanged.
- The success view shows the existing registration reference, a Copy button,
  and next-step guidance. No risk, score, or model output is shown.
- `session_length_in_minutes` still starts when the page opens and is calculated
  at submission, across all three steps. The test freezes time at open and
  submit to verify a one-minute payload. The v2 coefficient is
  `0.036539` for `num__session_length_in_minutes`; the missing-indicator
  coefficient is `0.018868`. These are model coefficients, not raw
  per-minute effects, and are not displayed to users.
- English is the only shipped language in this proposal. The optional
  English/Kiswahili toggle is deferred; no Kiswahili strings are shipped.
  Any Kiswahili strings added later must be marked for human review here before
  enabling that language.

The `/join` production JavaScript chunk is **17.40 kB raw / 6.19 kB gzip**, compared
with **10.30 kB / 4.25 kB** before the redesign. The global CSS asset is
**51.31 kB / 13.19 kB gzip**, compared with **31.83 kB / 9.56 kB** before.
No chart, animation, or other package was added. The route remains lazy-loaded;
reporting the CSS separately makes its shared initial-load cost explicit.

### Proposal screenshots

The compressed 256-color PNGs are in
[`docs/screenshots/v1.4.0/identity-proposal/`](screenshots/v1.4.0/identity-proposal/).
All retain their original dimensions (1440 px desktop and 390 px phone width).
Palette compression reduced the set from 5,707,849 bytes to 2,017,193 bytes
(64.7%).

| Screen         | Before                                     | After                                                                                   |
| -------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| Sign in        | `before-sign-in-{desktop,phone}.png`       | `after-sign-in-{desktop,phone}.png`                                                     |
| Admin Overview | `before-overview-{desktop,phone}.png`      | `after-overview-{desktop,phone}.png`                                                    |
| Agents table   | `before-agents-{desktop,phone}.png`        | `after-agents-{desktop,phone}.png`                                                      |
| Agent drawer   | `before-agents-drawer-{desktop,phone}.png` | `after-agents-drawer-{desktop,phone}.png`                                               |
| Join form      | `before-join-form-{desktop,phone}.png`     | `after-join-step-{1,2,3}-{desktop,phone}.png`                                           |
| Join states    | `before-join-success-{desktop,phone}.png`  | `after-join-step-1-empty-{desktop,phone}.png`, `after-join-success-{desktop,phone}.png` |

The after set also includes both widths of the completed and empty first step.
Screenshots are deterministic, use mocked data, and can be recreated with:

```powershell
Push-Location frontend
$env:SCREENSHOT_SET = "after"
npx playwright test identity-screenshots --project=desktop --workers=2
Remove-Item Env:SCREENSHOT_SET
Pop-Location
```

The join steps are checked with axe and for horizontal overflow at 360 px;
keyboard coverage verifies the fields and actions on each step. The monthly
agent trends reuse the existing per-agent KPI endpoint and are cached for five
minutes. The current list can make up to 25 KPI requests; if that load proves
too high, a batched KPI endpoint would need a separately approved API change.

### Verification

- `npm run lint` — passed.
- `npm run build` — passed, including `tsc -b`.
- `npx vitest run --maxWorkers=1 --testTimeout 15000` — 16 files and 116
  tests passed.
- `npx playwright test --workers=1` — 72 passed; 90 expected skips (the two
  screenshot suites require their opt-in environment variables, and keyboard
  tests are skipped on touch devices).
- `npx playwright test pages.spec.ts --grep "agents empty state" --workers=1`
  — 2 passed at 360 px (desktop and phone projects).
- `$env:SCREENSHOT_SET = "after"; npx playwright test identity-screenshots --project=desktop --workers=2`
  — 10 screenshot cases passed for the requested 1440 px and 390 px views
  (run from `frontend`).

## Phase 1b Identity Rollout (Step 2)

The approved identity now applies across the workspace, authentication,
customer-registration, profile, and status pages. The shared table, pagination,
drawers, permissions, API contracts, and accessibility behavior are unchanged.
No scoring features, response fields, or client/agent disclosures were added.

### Applied rules

- Shared workspace headers use the blue-to-mint mesh palette, subtle node-ring
  motif, and restrained gradient; standard KPI and chart cards use the same
  line, radius, and low-shadow treatment. Existing Overview KPI icons, trend
  arrows, mini charts, and the attention panel remain.
- Initials avatars use a deterministic hash into five high-contrast color
  pairs. Stable user IDs are preferred over names; admin, agent, and client
  top bars, the user table/drawer, and Profile use the same avatar component.
- Risk-band row accents remain limited to data that has a real band, and the
  text badge remains visible. User records receive no invented risk band.
- The Review queue uses the existing assessment probability in a compact
  meter with the percentage always shown as text and exposed as an accessible
  meter. This stays admin-only; it does not add fields or appear in agent or
  client pages.
- The shared `ListTable` empty state uses the original mesh SVG. Search,
  sorting, row actions, pagination, drawers, and empty-state wording remain
  unchanged.
- Shared table cards use a three-pixel brand-accent top edge, a light
  blue-to-mint toolbar, a compact result-count pill, calm uppercase headers,
  subtle alternating row fills, visible hover/selection states, and mobile
  cards with restrained shadows. Risk-band row edges and text badges remain
  unchanged. Shared drawers use a mesh-gradient header and grouped section
  cards; no table or drawer exposes new fields.
- Public registration, registration-pending, sign-up, Forgot Password, Profile,
  change-password, and 403/404 status pages share the visual identity. Password
  reset email links continue to be handled by Firebase; there is no separate
  in-app reset-token route.
- Motion is limited to the card hover treatment and the existing join/drawer
  transitions. Reduced-motion preferences disable transitions and animation.
  Focus rings remain visible, and the new decorative art is not interactive.
- English remains the only shipped language. No Kiswahili strings were added;
  any future Kiswahili strings must be marked for human review here before
  enabling the optional toggle.

### Step 2 screenshots and bundle

The refreshed, mocked screenshots are saved in
[`docs/screenshots/v1.4.0/identity/`](screenshots/v1.4.0/identity/). They use
JPEG quality 82 at 1440 px desktop and 390 px phone widths. The set covers
Sign in, sign-up, registration-pending, Forgot Password, `/join` steps and
success, admin Overview/Agents/Review queue/Eligibility/Model/User management/
Audit log/Settings/Profile/change-password, agent Referral link/My customers/
My activity, client Quality dashboard, and the available 403/404 pages. Drawer
screenshots are included for agents, agent detail, users, audit log, and
eligibility. The set contains 68 JPEGs totaling 8,912,925 bytes (8.50 MiB).
There is no addressable error-boundary route; the generic error
fallback uses the same status-page styling.

Recreate the set from `frontend` (the JPEG setting reduces screenshot storage;
it does not change application assets):

```powershell
New-Item -ItemType Directory -Force ..\docs\screenshots\v1.4.0\identity | Out-Null
$env:SCREENSHOT_SET = "after"
$env:SCREENSHOT_DIR = "..\docs\screenshots\v1.4.0\identity"
$env:SCREENSHOT_FORMAT = "jpeg"
npx playwright test identity-screenshots.spec.ts screenshots.spec.ts --project=desktop --workers 1
Remove-Item Env:SCREENSHOT_SET, Env:SCREENSHOT_DIR, Env:SCREENSHOT_FORMAT
```

### Step 2 verification

- `npm run lint` — passed without warnings.
- `npm run format:check` — passed.
- `npm run build` — passed, including `tsc -b`; `/join` is 17.40 kB raw /
  6.18 kB gzip and the shared CSS is 55.55 kB / 13.95 kB gzip.
- `npx vitest run --maxWorkers=1 --testTimeout 15000` — 16 files and 117
  tests passed.
- `npx playwright test --workers 1` — 83 passed, 135 expected skips; the
  opt-in screenshot suites are skipped in this run.
- `npx playwright test e2e/pages.spec.ts --workers 1` — 63 passed, 9 expected
  skips, including axe WCAG checks and 360 px no-sideways-scroll checks.
- `npx playwright test identity-screenshots.spec.ts screenshots.spec.ts --project=desktop --workers 1`
  with the screenshot environment above — 60 passed; 68 compressed screenshots
  were produced in `docs/screenshots/v1.4.0/identity/`.

The v2 coefficient for `session_length_in_minutes` remains `0.036539`
(`num__session_length_in_minutes`); the missing-indicator coefficient remains
`0.018868`. The timer still starts when `/join` opens and stops at submit,
regardless of step navigation. No dependency or chart/animation library was
added.

## Screenshots

`docs/screenshots/v1.4.0/proposal/`, `before-*` and `after-*`, each at
desktop (1440 px) and phone (390 px) width, all with mocked data:

| View                       | Files                                        |
| -------------------------- | -------------------------------------------- |
| Agents list                | `*-agents-desktop.png`, `*-agents-phone.png` |
| Agents, no search match    | `*-agents-no-match-*.png`                    |
| Agents, loading            | `*-agents-loading-*.png`                     |
| Agent details drawer (new) | `after-agents-drawer-*.png`                  |
| Sign in                    | `*-sign-in-*.png`                            |
| Sign in with errors        | `*-sign-in-errors-*.png`                     |

They were taken by the Phase 0 version of `frontend/e2e/screenshots.spec.ts`
(commit 7e2dae3); the current spec takes the Phase 1 set below:

```powershell
Push-Location frontend
$env:SCREENSHOT_SET = "after"; npx playwright test screenshots --project=desktop
Remove-Item Env:SCREENSHOT_SET
Pop-Location
```

## Tables

| Topic      | Before                                             | Proposal                                                                                  |
| ---------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Structure  | Filters above a separate table card                | One card: toolbar, table, pager                                                           |
| Columns    | All values (Agents: 10, Client cut off at 1440 px) | 4-6 values used to compare rows; the rest in a details drawer                             |
| Rows       | 12 px padding; names wrap to two lines             | 60 px rows; name in bold with email below on one line each                                |
| Header     | Tinted, bold, scrolls away                         | White, 12 px semibold, sticky under the top bar                                           |
| Numbers    | Left-aligned                                       | Right-aligned, tabular figures, thousands separators                                      |
| Status     | Solid MUI chips (red/amber/green fills)            | Soft tinted badges with an icon and a text label                                          |
| Row action | Name link goes to the detail page                  | Row click, or Enter on the name button, opens the drawer; drawer links to the detail page |
| Pagination | None (41 rows in one page)                         | "1–25 of 41", 10/25/50 rows, first/previous/next/last                                     |
| URL        | Filters lost on reload                             | `?q=&band=&sort=&dir=&page=&size=`; defaults left out                                     |
| Phone      | Table scrolls sideways                             | Cards (900 px and below): name, badge, 3 stats, signals                                   |
| Loading    | One grey block                                     | Skeleton rows (cards on a phone) and a "Loading…" status                                  |
| Empty      | "No agents match."                                 | Icon, title, reason; "Clear search and filters" when filtered                             |

Agents columns: **Agent** (name and email), **Customers**, **Flags**,
**Reputation**, **Band**, **Signals** ("High assisted share", "Link
inactive"). Moved to the drawer: risk score (100 - reputation), confirmed
fake, pending review, assisted share, client, link state with its reason,
referral code. Sorting stays on Agent, Customers, Flags, and Reputation.

Trade-off: the drawer adds one click before the detail page, but the list can
be scanned without leaving it, and the page stays readable at any width.

## Status Badges

`StatusBadge` has five tones. Each tone has its own icon shape, and every
badge has a text label, so colour is never the only signal (WCAG 1.4.1).

| Tone    | Icon             | Used for (Agents)                | Text on fill       |
| ------- | ---------------- | -------------------------------- | ------------------ |
| error   | circle with !    | High risk                        | 4.9:1              |
| warning | triangle         | Watch, High assisted share       | 5.2:1 (dark amber) |
| success | circle with tick | Low risk                         | 4.7:1              |
| neutral | circle with dash | Insufficient data, Link inactive | above 5:1          |
| info    | circle with i    | (reserved: e.g. Audit)           | above 5:1          |

## Forms (Sign In)

- Labels sit above the fields and stay readable while typing (a floating
  label shrinks into the border).
- 48 px fields and buttons; 20 px between fields; one field group and one
  action group.
- The server error is shown first, above the fields, where it is read first.
- Field errors start with an icon and are linked to the input
  (`aria-describedby`, `aria-invalid`).
- "Forgot password?" shares the line under the password field instead of
  taking a row of its own; the tab order is email, password, show password,
  forgot password.
- The busy button shows a small spinner and "Signing in…".
- Field borders use `fieldBorder` (3:1 on white).

Table toolbars keep compact floating labels: they hold one-word filters and
must stay short.

## Accessibility

- Keyboard: the first cell of each row is a button that opens the drawer.
  The drawer is a modal dialog with a name: focus moves in, Tab stays in,
  Escape closes it, and focus returns to the row.
- Visible focus: the existing 3 px focus ring, inset on phone cards.
- The result count is a `status`, so screen readers hear "3 of 41 agents"
  after a search.
- Browser checks (`frontend/e2e`) run axe WCAG 2.2 AA and check that the page
  does not scroll sideways, at desktop and 360 px, for the Agents page, the
  drawer, and Sign in.

## Components (Phase 1 reuses these)

| File                                | Purpose                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `components/table/ListTable.tsx`    | Table, phone cards, skeleton, empty state, pager     |
| `components/table/TableToolbar.tsx` | Search (waits for a pause in typing), filters, count |
| `components/table/useListParams.ts` | Page, size, search, sort, filters in the URL         |
| `components/table/DetailDrawer.tsx` | Details drawer and label/value sections              |
| `components/table/StatusBadge.tsx`  | Tinted status badges, `BandStatus`                   |
| `components/form/StackedField.tsx`  | Field with label above; password variant             |

In Phase 0 the Agents page still loads every agent and filters, sorts, and
pages in the browser. Phase 1 adds `offset`/`limit`/`total` (and search and
sort) to `GET /admin/agents`; `ListTable` already takes `total`, `page`, and
`size`, so only the data source changes.

## Phase 0 Review Changes

Approved with three changes, all in Phase 1:

- The Flags column shows pending reviews too ("12 · 3 pending"), and a
  "Reviews: Has pending reviews" filter keeps those agents.
- The agent name is a real link to the detail page. A plain click or Enter
  opens the drawer; Ctrl/Cmd/Shift-click or a middle click opens the detail
  page in a new tab, as for any link. It is announced as a link that opens a
  dialog (`aria-haspopup="dialog"`).
- Screenshots are 256-colour PNGs (about a quarter of the original size).

## Phase 1: Every List

Every list uses `ListTable`: one card with a toolbar (search, filters, result
count), a sticky header, row hover, right-aligned numbers, status badges, an
empty state, a skeleton while loading, and cards at 900 px and below.

| Page                                    | Columns                                                                                        | Drawer (row click)                                                                      | Toolbar                                       | Data                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------ |
| Agents                                  | Agent, Customers, Flags (with pending), Reputation, Band, Signals                              | Score, customers, account                                                               | Search, Band, Reviews, Client                 | Server                               |
| Agent detail: customers                 | Customer (name, reference), Registered, Status, Commission, Probability                        | Registration and scoring; "Open assessment"                                             | Search name or reference                      | Server                               |
| Agent detail and Overview: monthly KPIs | Month, Registrations, Flag rate, Confirmed fake, Verification rate (+ Reputation for an agent) | Every figure of the month                                                               | None (12 fixed months)                        | Report                               |
| Overview: needs attention               | Agent, Customers, Reputation, Band                                                             | Links to agent detail                                                                   | None (at most 5 rows)                         | Server (`limit=5`)                   |
| Overview: flag-rate benchmark           | Agent, Registrations, Flag rate, Against network, Signals                                      | Links to agent detail                                                                   | Search, sortable                              | Browser (from `/admin/kpis`)         |
| Review queue                            | Customer, Agent, Registered, Probability, Source, Top reason                                   | The review dialog                                                                       | Search customer or agent, Show (flags/audits) | Server                               |
| User management                         | Account (email, organisation), Role, Status, Created                                           | Account details; role, active switch, approve/reject, organisation name, password email | Search by email, Role, Status                 | Server                               |
| Audit log                               | Time, Action, Outcome, Actor, Target or subject                                                | Full IDs and request ID                                                                 | Search action, subject, or ID; Outcome        | Server                               |
| Eligibility: by month                   | Month, Eligible, Pending, Not eligible                                                         | None                                                                                    | None (12 fixed months)                        | Report                               |
| Eligibility: by agent                   | Agent, Eligible, Pending, Not eligible                                                         | 12 months for the agent                                                                 | Search, Period                                | Server                               |
| Model: test metrics; monitoring         | Metric, Value; Month, Assessments, Flag rate, Mean probability                                 | None                                                                                    | None (fixed rows)                             | Report                               |
| My customers (agent)                    | Customer, Registered, Registered on my device                                                  | None (nothing more to show)                                                             | Search by name, Registered (device)           | Server                               |
| My activity (agent)                     | Month, Registrations, Eligible, Awaiting verification                                          | None                                                                                    | None (12 fixed months)                        | Report                               |
| Client: monthly trend                   | Month, Registrations, Confirmed fake, Confirmed fake %                                         | None                                                                                    | None (12 fixed months)                        | Report                               |
| Client: eligibility by agent            | Agent, Eligible, Not eligible                                                                  | None (clients see only these)                                                           | Search, sortable                              | Browser (from `/client/eligibility`) |

Fixed 12-month reports and the 5-row summary have no search or pager:
filtering twelve months adds controls without helping anyone. Everything
else pages with "1–25 of 3,388", 10/25/50 rows, and first/previous/next/last,
with page, size, search, sort, and filters in the URL (`?q=&page=&size=` plus
each filter; the benchmark uses a `bench_` prefix). A page past the end, for
example after a filter, moves to the last page.

Behaviour, permissions, and privacy are unchanged. Agents and clients see
exactly the fields they saw before; the new My customers filter uses only
`assisted`, which agents already saw. Status chips everywhere (including the
review dialog) are now the tinted `StatusBadge`; reason sources (Model, Rule,
Audit) stay outlined chips because they are labels, not statuses.

### API Changes

All additive except one shape change:

- `GET /admin/agents` returns `{items, total}` instead of an array, with
  `offset`, `limit`, `q`, `band` (repeatable), `has_pending`, `no_client`,
  `sort`, and `dir`. The ranking is still computed in full on the server
  (reputation is computed on read and the network assisted share needs every
  agent), then filtered, sorted, and sliced.
- `GET /admin/eligibility`: `offset`, `limit`, `q`, and `agents_total`.
- `GET /admin/users`: `q`, `role`, `status`.
- `GET /admin/audit-logs`: `q`, `outcome`.
- `GET /admin/review-queue`: `q`, `kind`.
- `GET /admin/agents/{id}`: `q` for the customers.
- `GET /me/customers`: `q`, `assisted`.

The users and audit-log endpoints already paged; the page now pages,
searches, and filters on the server instead of within the loaded page.
Tests: `backend/tests/test_list_endpoints.py`.

### Screenshots

`docs/screenshots/v1.4.0/tables/`: `before-*` (v1.4.0-rc1) and `after-*` for
11 pages at desktop (1440 px) and phone (390 px), plus `after-*-drawer-*` for
the new drawers. Re-create the "after" set with:

```powershell
Push-Location frontend
$env:SCREENSHOT_SET = "after"; npx playwright test screenshots --project=desktop --workers=4
Remove-Item Env:SCREENSHOT_SET
Pop-Location
```

The "before" set ran the same spec in a worktree of v1.4.0-rc1 with
`SCREENSHOT_SET=before` and `SCREENSHOT_DIR` set to this folder.
