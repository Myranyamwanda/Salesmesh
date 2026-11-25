// Screenshots of every list page, not a test. Skipped unless SCREENSHOT_SET
// is set ("before" or "after"), so CI never runs it:
//   $env:SCREENSHOT_SET = "after"; npx playwright test screenshots --project=desktop
// Images go to SCREENSHOT_DIR (default docs/screenshots/v1.4.0/tables/).
// "before" runs this file against the v1.4.0-rc1 frontend, whose agents list
// was one unpaged array. All data is invented and every API call is mocked.
import { expect, test, type Page } from "@playwright/test";
import type { UserRole } from "../src/types/auth";
import { mockApi } from "./mockApi";
import {
  agents,
  customers,
  eligibilityAgents,
  screenshotOverrides,
  users,
} from "./screenshotData";

const set = process.env.SCREENSHOT_SET;
const dir = process.env.SCREENSHOT_DIR ?? "../docs/screenshots/v1.4.0/tables";
const imageType = process.env.SCREENSHOT_FORMAT === "jpeg" ? "jpeg" : "png";
const imageExtension = imageType === "jpeg" ? "jpg" : "png";
const legacy = set === "before";
const sizes = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};

test.skip(!set, "Set SCREENSHOT_SET to take screenshots");
test.skip(({ isMobile }) => isMobile, "Sizes are set per screenshot");

// --- Screenshots ---------------------------------------------------------------

async function open(page: Page, role: UserRole, path: string) {
  await mockApi(page, role, screenshotOverrides(legacy));
  await page.goto(path);
  // Lazy pages load slowly when every worker builds charts at once.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1, {
    timeout: 20000,
  });
  await expect(page.getByRole("progressbar")).toHaveCount(0, {
    timeout: 20000,
  });
  // Wait for the first list to show rows (or its empty state).
  await page.waitForTimeout(800);
}

async function shot(page: Page, name: string, size: keyof typeof sizes) {
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${dir}/${set}-${name}-${size}.${imageExtension}`,
    fullPage: true,
    animations: "disabled",
    type: imageType,
    ...(imageType === "jpeg" ? { quality: 82 } : {}),
  });
}

const pages: [string, UserRole, string][] = [
  ["overview", "admin", "/admin"],
  ["agents", "admin", "/admin/agents"],
  ["agent-detail", "admin", `/admin/agents/${agents[2].id}`],
  ["review-queue", "admin", "/admin/review-queue"],
  ["users", "admin", "/admin/users"],
  ["audit-log", "admin", "/admin/audit-log"],
  ["eligibility", "admin", "/admin/eligibility"],
  ["model", "admin", "/admin/models"],
  ["settings", "admin", "/admin/settings"],
  ["profile", "admin", "/profile"],
  ["change-password", "admin", "/change-password"],
  ["referral-link", "agent", "/agent"],
  ["my-customers", "agent", "/agent/customers"],
  ["my-activity", "agent", "/agent/activity"],
  ["client-quality", "client", "/client"],
];

for (const size of ["desktop", "phone"] as const) {
  for (const [name, role, path] of pages) {
    test(`${name} ${size}`, async ({ page }) => {
      await page.setViewportSize(sizes[size]);
      await open(page, role, path);
      await shot(page, name, size);
    });
  }
}

// The details drawers are new, so they exist only in the "after" set.
const drawers: [string, UserRole, string, string][] = [
  ["agents-drawer", "admin", "/admin/agents", agents[0].display_name],
  [
    "agent-detail-drawer",
    "admin",
    `/admin/agents/${agents[2].id}`,
    customers[0].full_name,
  ],
  ["users-drawer", "admin", "/admin/users", users[4 + 4].email],
  ["audit-log-drawer", "admin", "/admin/audit-log", "login"],
  [
    "eligibility-drawer",
    "admin",
    "/admin/eligibility",
    eligibilityAgents[0].agent.display_name,
  ],
];

for (const size of ["desktop", "phone"] as const) {
  for (const [name, role, path, text] of drawers) {
    test(`${name} ${size}`, async ({ page }) => {
      test.skip(legacy, "The drawers are new");
      await page.setViewportSize(sizes[size]);
      await open(page, role, path);
      await page
        .locator(".row-open, .list-card-row")
        .filter({ hasText: text })
        .first()
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(500);
      // The viewport only: the drawer covers the page beneath it.
      await page.screenshot({
        path: `${dir}/${set}-${name}-${size}.${imageExtension}`,
        animations: "disabled",
        type: imageType,
        ...(imageType === "jpeg" ? { quality: 82 } : {}),
      });
    });
  }
}
