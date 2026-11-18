# UI Redesign (v1.4.0): Tables and Forms

Supervisor feedback on v1.3.0: tables and forms looked plain and crowded.
This document is the design direction. Phase 0 applies it to one table
(Agents) and one form (Sign in); Phase 1 applies it to every list.

It builds on the design tokens in `frontend/src/tokens.ts` (see
[workspace-pages.md](workspace-pages.md#design-tokens)). Phase 0 adds four
tokens: `warningTint`, `errorTint` (badge fills), `fieldBorder` (form field
outline, 3:1 on white for WCAG 1.4.11) and nothing else; colours, fonts, and
radii are unchanged.

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

Re-create them with:

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
