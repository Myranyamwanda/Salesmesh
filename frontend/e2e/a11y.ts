// Shared browser checks: an axe scan against WCAG 2.2 A and AA, and no
// sideways page scrolling (WCAG 1.4.10 Reflow at 320-360 px).
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

export async function expectNoAxeViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  // One readable line per problem, so a failure says what to fix and where.
  const problems = violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id}: ${node.target.join(" ")} - ${node.failureSummary?.split("\n")[1]?.trim() ?? violation.help}`,
    ),
  );
  // Soft, so the other checks still run and report too.
  expect.soft(problems, "axe WCAG violations").toEqual([]);
}

export async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect.soft(overflow, "page wider than the screen").toBeLessThanOrEqual(0);
}

/** Wait until the page has its title and every loading spinner is gone. */
export async function waitForPage(page: Page) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
}
