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

  test("registration link: the whole form can be completed by keyboard", async ({
    page,
  }) => {
    await mockApi(page, null);
    await page.goto("/join/AGT-7K3Q2MNP");
    await waitForPage(page);
    const stops = await tabThrough(page, 25);
    const names = stops.map((stop) => stop.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Full name",
        "Email address",
        "Mobile number",
        "Date of birth",
        "Country",
        "How we use your data",
        "Register",
      ]),
    );
    expectAllVisible(stops);
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
