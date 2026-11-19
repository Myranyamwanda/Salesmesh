// Keyboard use: every control can be reached with Tab and shows a visible
// focus indicator (WCAG 2.1.1, 2.4.7), and the skip link bypasses the menus.
import { expect, test, type Page } from "@playwright/test";
import type { UserRole } from "../src/types/auth";
import { waitForPage } from "./a11y";
import { mockApi } from "./mockApi";

type Stop = { name: string; visible: boolean };

/** Press Tab up to `max` times and describe each focused element. */
async function tabThrough(page: Page, max: number): Promise<Stop[]> {
  const stops: Stop[] = [];
  for (let index = 0; index < max; index += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      const outlined =
        style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
      // Text fields show focus with their own 2 px border instead.
      const field = element.closest(".MuiOutlinedInput-root.Mui-focused");
      const name =
        element.getAttribute("aria-label") ||
        (element as HTMLInputElement).labels?.[0]?.textContent ||
        element.textContent ||
        element.tagName;
      return {
        name: name.trim().slice(0, 60),
        visible: outlined || Boolean(field),
      };
    });
    if (!stop) break;
    stops.push(stop);
  }
  return stops;
}

function expectAllVisible(stops: Stop[]) {
  expect(
    stops.filter((stop) => !stop.visible).map((stop) => stop.name),
  ).toEqual([]);
}

test.describe("keyboard", () => {
  // The phone project has no keyboard; these run once, at desktop width.
  test.skip(({ isMobile }) => isMobile);

  test("sign-in page: every control is reachable with a visible focus", async ({
    page,
  }) => {
    await mockApi(page, null);
    await page.goto("/login");
    await waitForPage(page);
    // The email field is focused on arrival; Tab continues from there.
    await expect(page.getByLabel("Email address")).toBeFocused();
    const stops = await tabThrough(page, 15);
    const names = stops.map((stop) => stop.name);
    expect(names).toEqual(
      expect.arrayContaining(["Password", "Show password", "Forgot password?"]),
    );
    expect(names.some((name) => /sign in/i.test(name))).toBe(true);
    expectAllVisible(stops);
  });

  test("registration steps: every field and action is keyboard accessible", async ({
    page,
  }) => {
    await mockApi(page, null);
    await page.goto("/join/AGT-7K3Q2MNP");
    await waitForPage(page);
    await expect(page.getByLabel("Full name")).toBeFocused();
    await page.getByLabel("Full name").fill("Wanjiru Kamau");
    await page.getByLabel("Email address").fill("wanjiru.k@example.com");
    await page.getByLabel("Mobile number").fill("0712345678");
    await page.getByLabel("Date of birth").fill("1994-03-12");
    await page.getByLabel("Full name").focus();
    const aboutYouStops = await tabThrough(page, 12);
    const aboutYouNames = aboutYouStops.map((stop) => stop.name);
    expect(aboutYouNames).toEqual(
      expect.arrayContaining([
        "Email address",
        "Mobile number",
        "Secondary phone number (optional)",
        "Continue",
      ]),
    );
    expect(aboutYouNames.some((name) => name.startsWith("Date of birth"))).toBe(
      true,
    );
    expectAllVisible(aboutYouStops);

    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Where you live" }),
    ).toBeFocused();
    const locationStops = await tabThrough(page, 12);
    const locationNames = locationStops.map((stop) => stop.name);
    expect(locationNames).toEqual(
      expect.arrayContaining([
        "Country",
        "Years",
        "Months",
        "Back",
        "Continue",
      ]),
    );
    expectAllVisible(locationStops);

    await page.getByLabel("Years").first().selectOption("1");
    await page.getByLabel("Months").first().selectOption("2");
    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    const reviewHeading = page.getByRole("heading", {
      name: "Review and consent",
    });
    await expect(reviewHeading).toBeVisible();
    await reviewHeading.focus();
    const reviewStops = await tabThrough(page, 8);
    const reviewNames = reviewStops.map((stop) => stop.name);
    expect(
      reviewNames.some((name) => name.includes("I agree that SalesMesh")),
    ).toBe(true);
    expect(reviewNames).toEqual(expect.arrayContaining(["Back", "Register"]));
    expectAllVisible(reviewStops);
  });

  test("agents list: open a row's details with Enter, close with Escape", async ({
    page,
  }) => {
    await mockApi(page, "admin");
    await page.goto("/admin/agents");
    await waitForPage(page);
    const open = page.getByRole("link", { name: /Amina Otieno/ });
    await open.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "Amina Otieno" });
    await expect(drawer).toBeVisible();
    // Focus moves into the drawer and Tab stays inside it.
    await expect
      .poll(() =>
        drawer.evaluate((element) => element.contains(document.activeElement)),
      )
      .toBe(true);
    const stops = await tabThrough(page, 4);
    expectAllVisible(stops);
    expect(
      await drawer.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    // Focus returns to the row that opened it.
    await expect(open).toBeFocused();
  });

  for (const [role, path] of [
    ["admin", "/admin"],
    ["agent", "/agent"],
    ["client", "/client"],
  ] as [UserRole, string][]) {
    test(`${role} workspace: skip link, then menus with a visible focus`, async ({
      page,
    }) => {
      await mockApi(page, role);
      await page.goto(path);
      await waitForPage(page);

      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to main content" });
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(page.locator("#main")).toBeFocused();

      // From the top again: the skip link, the top bar, then the menus.
      await page.reload();
      await waitForPage(page);
      const stops = await tabThrough(page, 12);
      expect(stops.length).toBeGreaterThan(3);
      expectAllVisible(stops);
    });
  }
});
