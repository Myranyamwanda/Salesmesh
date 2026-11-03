// The customer registration page (/join) on a phone and a desktop: input
// types, errors next to their fields, and status messages that are announced.
import { expect, test, type Page } from "@playwright/test";
import {
  expectNoAxeViolations,
  expectNoSidewaysScroll,
  waitForPage,
} from "./a11y";
import { mockApi } from "./mockApi";

const JOIN = "/join/AGT-7K3Q2MNP";

async function fillValidForm(page: Page) {
  await page.getByLabel("Full name").fill("Wanjiru Kamau");
  await page.getByLabel("Email address").fill("wanjiru.k@example.com");
  await page.getByLabel("Mobile number").fill("0712345678");
  await page.getByLabel("Date of birth").fill("1994-03-12");
  await page.getByLabel(/current address/).fill("14");
  await page.getByRole("checkbox", { name: /I agree/ }).check();
}

test("fields use the right keyboard and autofill on a phone", async ({
  page,
}) => {
  await mockApi(page, null);
  await page.goto(JOIN);
  await waitForPage(page);
  const field = (label: string | RegExp) => page.getByLabel(label);
  await expect(field("Email address")).toHaveAttribute("type", "email");
  await expect(field("Email address")).toHaveAttribute("autocomplete", "email");
  await expect(field("Mobile number")).toHaveAttribute("type", "tel");
  await expect(field("Mobile number")).toHaveAttribute("autocomplete", "tel");
  await expect(field(/Secondary phone/)).toHaveAttribute("type", "tel");
  await expect(field("Full name")).toHaveAttribute("autocomplete", "name");
  await expect(field("Date of birth")).toHaveAttribute("type", "date");
  await expect(field("Country")).toHaveAttribute("autocomplete", "country");
  await expect(field(/current address/)).toHaveAttribute(
    "inputmode",
    "numeric",
  );
});

test("errors appear next to their fields and focus moves to the first", async ({
  page,
}) => {
  const unexpected = await mockApi(page, null);
  await page.goto(JOIN);
  await waitForPage(page);
  await page.getByRole("button", { name: "Register" }).click();

  const name = page.getByLabel("Full name");
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  // The error is read out with the field, not only shown in red.
  await expect(name).toHaveAccessibleDescription(/\S/);
  const consent = page.getByRole("checkbox", { name: /I agree/ });
  await expect(consent).toHaveAttribute("aria-invalid", "true");
  await expect(consent).toHaveAccessibleDescription(
    "Please agree before registering",
  );

  await expectNoAxeViolations(page);
  await expectNoSidewaysScroll(page);
  expect(unexpected).toEqual([]);
});

test("a refused email is shown under the email field", async ({ page }) => {
  await mockApi(page, null, {
    "POST /join/:id/register": () => ({
      status: 422,
      body: {
        error: {
          code: "email_not_permanent",
          message: "Use a permanent email address",
        },
      },
    }),
  });
  await page.goto(JOIN);
  await waitForPage(page);
  await fillValidForm(page);
  await page.getByRole("button", { name: "Register" }).click();

  const email = page.getByLabel("Email address");
  await expect(email).toBeFocused();
  await expect(email).toHaveAccessibleDescription(
    "Use a permanent email address",
  );
  await expect(page.getByLabel("Full name")).toHaveValue("Wanjiru Kamau");
  await expectNoSidewaysScroll(page);
});

test("a failed submission keeps the details and says so in an alert", async ({
  page,
}) => {
  await mockApi(page, null, {
    "POST /join/:id/register": () => ({
      status: 500,
      body: {
        error: { code: "internal_error", message: "Something went wrong." },
      },
    }),
  });
  await page.goto(JOIN);
  await waitForPage(page);
  await fillValidForm(page);
  await page.getByRole("button", { name: "Register" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Your details are still here.",
  );
  await expect(page.getByLabel("Full name")).toHaveValue("Wanjiru Kamau");
  await expectNoAxeViolations(page);
});

test("success is announced with the reference number", async ({ page }) => {
  const unexpected = await mockApi(page, null, {
    "POST /join/:id/register": () => ({
      status: 201,
      body: { message: "Registration received", reference: "REG-4F7K2M" },
    }),
  });
  await page.goto(JOIN);
  await waitForPage(page);
  await fillValidForm(page);
  await page.getByRole("button", { name: "Register" }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Registration received");
  await expect(status.getByLabel("Reference number REG-4F7K2M")).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoSidewaysScroll(page);
  expect(unexpected).toEqual([]);
});
