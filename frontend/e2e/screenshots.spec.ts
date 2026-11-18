// Screenshots for the UI redesign proposal, not a test. Skipped unless
// SCREENSHOT_SET is set ("before" or "after"), so CI never runs it:
//   $env:SCREENSHOT_SET = "after"; npx playwright test screenshots --project=desktop
// Images go to docs/screenshots/v1.4.0/proposal/. All data is mocked.
import { expect, test, type Page } from "@playwright/test";
import type { AgentRanking, Band } from "../src/types/scoring";
import { API, mockApi } from "./mockApi";
import { agents as fixtureAgents } from "./fixtures";

const set = process.env.SCREENSHOT_SET;
const dir = "../docs/screenshots/v1.4.0/proposal";
const sizes = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};

test.skip(!set, "Set SCREENSHOT_SET to take screenshots");
test.skip(({ isMobile }) => isMobile, "Sizes are set per screenshot");

// 41 invented agents, like the demo network, so pagination has pages to show.
const first = ["Amina", "Brian", "Chebet", "Daudi", "Esther", "Felix", "Grace"];
const last = ["Otieno", "Mwangi", "Kiprono", "Korir", "Wanjiku", "Ochieng"];

function band(reputation: number, customers: number): Band {
  if (customers < 30) return "Insufficient data";
  if (reputation < 90) return "High risk";
  if (reputation < 92) return "Watch";
  return "Low risk";
}

const networkAgents: AgentRanking[] = Array.from({ length: 41 }, (_, i) => {
  const customers = i === 7 ? 18 : 60 + ((i * 37) % 70);
  const reputation = Math.round((86 + ((i * 53) % 135) / 10) * 10) / 10;
  const flags = Math.max(0, Math.round(((100 - reputation) / 100) * customers));
  const base = fixtureAgents[0];
  return {
    ...base,
    id: `agent-${i + 1}`,
    display_name: `${first[i % first.length]} ${last[(i * 5) % last.length]}`,
    email: `agent${i + 1}@demo.example.com`,
    referral_code: `AGT-${(i * 7919).toString(36).toUpperCase().padStart(8, "K")}`,
    n_users: customers,
    flags,
    confirmed_fake: Math.floor(flags / 2),
    pending_review: flags - Math.floor(flags / 2),
    assisted_share: i === 40 ? 0.6 : 0.05 + (i % 5) / 50,
    assisted_alert: i === 40,
    client: i === 12 ? null : base.client,
    link_active: i !== 12,
    reputation,
    risk_score: Math.round((100 - reputation) * 10) / 10,
    band: band(reputation, customers),
  };
});

async function shot(page: Page, name: string, size: keyof typeof sizes) {
  await page.setViewportSize(sizes[size]);
  // Let the layout settle after the resize (media queries, drawers).
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${dir}/${set}-${name}-${size}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

async function openAgents(page: Page) {
  await mockApi(page, "admin", {
    "GET /admin/agents": () => ({ body: networkAgents }),
  });
  await page.goto("/admin/agents");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agents");
  await expect(page.getByText("Amina Otieno").first()).toBeVisible();
}

for (const size of ["desktop", "phone"] as const) {
  test(`agents ${size}`, async ({ page }) => {
    await page.setViewportSize(sizes[size]);
    await openAgents(page);
    await shot(page, "agents", size);
  });

  test(`agents no match ${size}`, async ({ page }) => {
    await page.setViewportSize(sizes[size]);
    await openAgents(page);
    await page.getByLabel("Search agents").fill("zzz");
    await shot(page, "agents-no-match", size);
  });

  test(`agents loading ${size}`, async ({ page }) => {
    await page.setViewportSize(sizes[size]);
    await mockApi(page, "admin");
    // Registered last, so it wins: the list never arrives.
    await page.route(`${API}/admin/agents`, () => undefined);
    await page.goto("/admin/agents");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agents");
    await shot(page, "agents-loading", size);
  });

  test(`agents drawer ${size}`, async ({ page }) => {
    test.skip(set !== "after", "The drawer is new");
    await page.setViewportSize(sizes[size]);
    await openAgents(page);
    await page
      .getByRole("button", { name: /Amina Otieno/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${dir}/${set}-agents-drawer-${size}.png`,
      animations: "disabled",
    });
  });

  test(`sign in ${size}`, async ({ page }) => {
    await page.setViewportSize(sizes[size]);
    await mockApi(page, null);
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await shot(page, "sign-in", size);
  });

  test(`sign in errors ${size}`, async ({ page }) => {
    await page.setViewportSize(sizes[size]);
    await mockApi(page, null);
    await page.goto("/login");
    await page.getByLabel("Email address").fill("amina@");
    await page.getByRole("button", { name: /^Sign in$/ }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await shot(page, "sign-in-errors", size);
  });
}
