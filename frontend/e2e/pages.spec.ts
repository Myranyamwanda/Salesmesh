// Every page, for its role, at desktop and phone width: one page title, no
// axe WCAG A/AA violations (including colour contrast), and no sideways scroll.
import { expect, test } from "@playwright/test";
import type { UserRole } from "../src/types/auth";
import {
  expectNoAxeViolations,
  expectNoSidewaysScroll,
  waitForPage,
} from "./a11y";
import { mockApi } from "./mockApi";

const pages: [UserRole | null, string][] = [
  [null, "/login"],
  [null, "/register"],
  [null, "/registration-pending"],
  [null, "/forgot-password"],
  [null, "/join/AGT-7K3Q2MNP"],
  [null, "/join/AGT-INACTIVE"],
  [null, "/404"],
  [null, "/403"],
  ["admin", "/admin"],
  ["admin", "/admin/agents"],
  ["admin", "/admin/agents/agent-3"],
  ["admin", "/admin/review-queue"],
  ["admin", "/admin/eligibility"],
  ["admin", "/admin/models"],
  ["admin", "/admin/users"],
  ["admin", "/admin/audit-log"],
  ["admin", "/admin/settings"],
  ["admin", "/profile"],
  ["agent", "/agent"],
  ["agent", "/agent/customers"],
  ["agent", "/agent/activity"],
  ["agent", "/join/AGT-7K3Q2MNP"],
  ["client", "/client"],
  ["client", "/profile"],
];

for (const [role, path] of pages) {
  test(`${role ?? "public"} ${path}`, async ({ page }) => {
    const unexpected = await mockApi(page, role);
    await page.goto(path);
    await waitForPage(page);
    await expectNoAxeViolations(page);
    await expectNoSidewaysScroll(page);
    expect(unexpected, "API calls without a mock").toEqual([]);
  });
}

test("admin review dialog", async ({ page }) => {
  const unexpected = await mockApi(page, "admin");
  await page.goto("/admin/review-queue");
  await waitForPage(page);
  await page
    .getByRole("button", { name: /review/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Threshold at scoring")).toBeVisible();
  await expectNoAxeViolations(page, '[role="dialog"]');
  await expectNoSidewaysScroll(page);
  expect(unexpected).toEqual([]);
});
