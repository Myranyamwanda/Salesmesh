# Accessibility and Mobile (v1.3.0)

SalesMesh targets **WCAG 2.2 level AA**. Customers register on their own
phones through `/join`, so that page also has to work well at phone width.

## How it is checked

`npm run test:e2e` (in `frontend/`) runs Playwright in Chromium against the
production build. Every API call is answered by mocked responses
(`frontend/e2e/mockApi.ts`, typed fixtures in `frontend/e2e/fixtures.ts`), so
the checks need no backend, database or Firebase. A call without a mock fails
the test, which keeps the mocks in step with the pages. The checks run in the
`frontend` GitHub Actions job after the build. If they fail there, the HTML
report is uploaded as the `playwright-report` artifact.

| File | What it checks |
| --- | --- |
| `e2e/pages.spec.ts` | 24 pages, each opened by its own role, plus the review dialog, at desktop width (1280 px) and phone width (360 px). Each page must have exactly one top-level heading, no axe violations for WCAG 2.0/2.1/2.2 A and AA (colour contrast included) and no sideways page scrolling (WCAG 1.4.10 Reflow) |
| `e2e/join.spec.ts` | `/join` input types and autofill hints, errors placed and announced with their fields, focus on the first error, a refused email shown under the email field, failure kept in an alert with the details still filled in, success announced in a status region with the reference number |
| `e2e/keyboard.spec.ts` | Every control on sign-in and `/join` reachable with Tab, with a visible focus indicator. In each workspace the skip link comes first and moves focus to the main content |

Why Playwright: the Vitest DOM (happy-dom) does not lay out or paint pages, so
it cannot measure contrast, focus rings or overflow. A real browser can.

Result on 2026-11-03: 65 passed. The 5 keyboard tests run only at desktop
width, so they show as skipped in the phone project.

## Issues found and fixed

The first run of the checks failed on every signed-in page. The table lists
each distinct issue. "Found by" says whether the automated check found it, or
whether I found it by reading the code and then added a test to guard it.

| # | Issue | WCAG | Where | Found by | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Footer and other small grey text 4.34:1 on the page background (`#6a7488` on `#f4f6fa`) | 1.4.3 Contrast | All workspace pages | axe | `subtle` token darkened to `#626c80` (4.88:1 on the background, 5.28:1 on white) |
| 2 | "Rule" reason chip text 2.15:1 (amber `#e8a33d` on white) | 1.4.3 Contrast | Review queue, review dialog | axe | New `accentText` token `#8f5b00` (5.73:1) for amber text. The light amber stays for decorative fills only |
| 3 | Sidebar links placed directly inside a list, and no navigation landmark | 1.3.1 Info and Relationships | All workspace pages | axe | The two menus are now `nav` elements named "Workspace" and "Account" |
| 4 | Sign-in brand link named "SalesMesh home", which does not include its visible text | 2.5.3 Label in Name | Sign-in, register, forgot password, pending | axe | The accessible name is now the visible text "SalesMesh" |
| 5 | Wide tables scroll sideways on a phone but could not be scrolled with the keyboard. Every table was named "Data table" | 2.1.1 Keyboard, 1.3.1 | Overview, agent detail, eligibility, audit log, model, agent and client pages | axe (phone) | Each scrolling table area can receive focus and is a named region. Every table has a real name (for example "Flag-rate benchmark") |
| 6 | No visible keyboard focus on buttons, menu items and checkboxes. MUI removes the browser outline and shows only a faint ripple | 2.4.7 Focus Visible | Everywhere | Code reading; now guarded by `keyboard.spec.ts` | One 3 px focus ring from the theme: blue on light backgrounds, white on the navy sidebar and sign-in panel. Text fields keep their 2 px focused border |
| 7 | No way to skip the menus | 2.4.1 Bypass Blocks | Workspaces | Code reading; now guarded | "Skip to main content" link, shown when it receives focus |
| 8 | Month fields on `/join` did not open the number keypad on phones. `inputMode` was set on the wrapper `div`, not on the `input`. The same applied to the Settings fields (decimal keypad) | Usability (not a WCAG failure) | `/join`, Settings | `join.spec.ts` | Set on the input element |
| 9 | Country select had no autofill hint | 1.3.5 Identify Input Purpose | `/join` | Code reading; now guarded | `autocomplete="country"` |
| 10 | Missing consent: the error was not linked to the checkbox, the checkbox was not marked invalid, and focus could not move to it | 3.3.1 Error Identification, 1.3.1 | `/join` | Code reading; now guarded | `aria-invalid`, `aria-describedby="consent-error"`, and the form's ref so that focus moves to it |

## Checked and already fine

- **`/join` at 360 px:** fields use `type="email"`, `type="tel"` (both phone
  numbers) and `type="date"`. Name, email, mobile and date of birth have
  autofill hints. Errors appear directly under their fields and are read out
  with them. The form keeps the customer's details after a failure.
- **Status messages:** MUI alerts have `role="alert"`, and the sign-in
  feedback uses `aria-live="polite"`. The registration success message is a
  `role="status"` region. Spinners have names, such as "Checking registration
  link".
- **No meaning by colour alone:** every badge and chip has a text label (band,
  source, "Audit", "High assisted share", status). Each chart has a table
  nearby with the same monthly numbers.
- **Reflow:** none of the 24 pages scrolls sideways at 360 px. Wide tables
  scroll inside their own area instead.
- **Honest states:** loading, empty and error states were reviewed in v1.2.0
  and v1.3.0 Phase 3 (`docs/failure-scenarios.md`).

## Limits

- **Automated checks find only part of WCAG.** They cannot judge whether
  wording is clear, whether focus order makes sense, or how a screen reader
  presents a page. The manual checks below cover some of this.
- **Mocked data:** the pages were checked with mocked data. Real names and
  numbers can be longer, which is why the phone test below uses the real
  stack.
- **Browsers:** the checks use Chromium only. Safari on iPhone was not tested
  automatically.

## Manual checks (developer)

1. **Phone:** start the stack with `.\scripts\dev.ps1 up-lan` (see README,
   "Testing on a Phone"), open an agent's `/join` link on your phone and
   register once.
   - The number keypad appears for the two month fields.
   - Errors appear under the fields.
   - Nothing scrolls sideways.
2. **Keyboard:** on a laptop, use only Tab, Shift+Tab, Enter and Space.
   - Sign in, open the review queue and review one registration.
   - Change one setting and sign out.
   - The focus ring is always visible, and the first Tab in a workspace
     shows "Skip to main content".
3. **Optional, screen reader:** with NVDA (free) on Windows, open `/join` and
   submit the empty form. NVDA should read each error with its field.
