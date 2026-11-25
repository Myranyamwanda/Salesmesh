// Screenshots of the visual identity screens (Phase 1b), not a test. Skipped
// unless SCREENSHOT_SET is set ("before" or "after"), so CI never runs it:
//   $env:SCREENSHOT_SET = "after"; npx playwright test identity-screenshots --project=desktop
// Images go to SCREENSHOT_DIR (default docs/screenshots/v1.4.0/identity-proposal/).
// "before" is the v1.4.0-rc2 frontend, whose /join was one long form. All data
// is invented and every API call is mocked.
import { expect, test, type Page } from "@playwright/test";
import type { UserRole } from "../src/types/auth";
import { mockApi } from "./mockApi";
import { agents, screenshotOverrides } from "./screenshotData";

const set = process.env.SCREENSHOT_SET;
const dir =
  process.env.SCREENSHOT_DIR ?? "../docs/screenshots/v1.4.0/identity-proposal";
const imageType = process.env.SCREENSHOT_FORMAT === "jpeg" ? "jpeg" : "png";
const imageExtension = imageType === "jpeg" ? "jpg" : "png";
const capturePrefix = dir.includes("identity-proposal") ? "" : "identity-";
const legacy = set === "before";
const sizes = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};
const JOIN = "/join/AGT-7K3Q2MNP";

test.skip(!set, "Set SCREENSHOT_SET to take screenshots");
test.skip(({ isMobile }) => isMobile, "Sizes are set per screenshot");

const joinOverrides = {
  "GET /join/:id": () => ({
    body: { display_name: "Amina Otieno", client_name: "Demo Client 1" },
  }),
  "POST /join/:id/register": () => ({
    status: 201,
    body: { message: "Registration received", reference: "SM-7K3Q-9XPA" },
  }),
};

async function open(page: Page, role: UserRole | null, path: string) {
  await mockApi(page, role, {
    ...screenshotOverrides(false),
    ...joinOverrides,
  });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1, {
    timeout: 20000,
  });
  await expect(page.getByRole("progressbar")).toHaveCount(0, {
    timeout: 20000,
  });
  await page.waitForTimeout(800);
}

async function shot(
  page: Page,
  name: string,
  size: keyof typeof sizes,
  fullPage = true,
) {
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${dir}/${set}-${capturePrefix}${name}-${size}.${imageExtension}`,
    fullPage,
    animations: "disabled",
    type: imageType,
    ...(imageType === "jpeg" ? { quality: 82 } : {}),
  });
}

for (const size of ["desktop", "phone"] as const) {
  for (const [name, path] of [
    ["registration", "/register"],
    ["registration-pending", "/registration-pending"],
    ["forgot-password", "/forgot-password"],
    ["forbidden", "/403"],
    ["not-found", "/404"],
  ] as const) {
    test(`${name} ${size}`, async ({ page }) => {
      await page.setViewportSize(sizes[size]);
      await open(page, null, path);
      await shot(page, name, size);
    });
  }

  test(`sign in ${size}`, async ({ page }) => {
    await page.setViewportSize(sizes[size]);
    await open(page, null, "/login");
    await shot(page, "sign-in", size);
  });

  test(`overview ${size}`, async ({ page }) => {
    await page.setViewportSize(sizes[size]);
    await open(page, "admin", "/admin");
    await shot(page, "overview", size);
  });

  test(`agents ${size}`, async ({ page }) => {
    await page.setViewportSize(sizes[size]);
    await open(page, "admin", "/admin/agents");
    await shot(page, "agents", size);
  });

  test(`agents drawer ${size}`, async ({ page }) => {
    await page.setViewportSize(sizes[size]);
    await open(page, "admin", "/admin/agents");
    await page
      .locator(".row-open, .list-card-row")
      .filter({ hasText: agents[0].display_name })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(500);
    // The viewport only: the drawer covers the page beneath it.
    await shot(page, "agents-drawer", size, false);
  });

  test(`join ${size}`, async ({ page }) => {
    await page.setViewportSize(sizes[size]);
    await open(page, null, JOIN);
    if (legacy) {
      await shot(page, "join-form", size);
      await page.getByLabel("Full name").fill("Wanjiru Kamau");
      await page.getByLabel("Email address").fill("wanjiru.k@example.com");
      await page.getByLabel("Mobile number").fill("0712345678");
      await page.getByLabel("Date of birth").fill("1994-03-12");
      await page.getByLabel(/current address/).fill("14");
      await page.getByRole("checkbox", { name: /I agree/ }).check();
      await page.getByRole("button", { name: "Register" }).click();
      await expect(page.getByText("Registration received")).toBeVisible();
      await shot(page, "join-success", size);
      return;
    }
    await shot(page, "join-step-1-empty", size);
    await page.getByLabel("Full name").fill("Wanjiru Kamau");
    await page.getByLabel("Email address").fill("wanjiru.k@gmial.com");
    await page.getByLabel("Mobile number").fill("712345678");
    await page.getByLabel("Date of birth").fill("1994-03-12");
    await expect(page.getByText(/Did you mean/)).toBeVisible();
    await shot(page, "join-step-1", size);
    await page
      .getByRole("button", { name: /Use wanjiru\.k@gmail\.com/ })
      .click();
    await page.getByRole("button", { name: "Continue" }).click();
    const current = page.getByRole("group", {
      name: "Time at your current address",
    });
    await current.getByLabel("Years").selectOption("1");
    await current.getByLabel("Months").selectOption("2");
    await shot(page, "join-step-2", size);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("checkbox", { name: /I agree/ }).check();
    await shot(page, "join-step-3", size);
    await page.getByRole("button", { name: "Register" }).click();
    await expect(
      page.getByRole("heading", { name: "Registration received" }),
    ).toBeVisible();
    await shot(page, "join-success", size);
  });
}
