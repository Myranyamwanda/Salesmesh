import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as portalApi from "../../api/portal";
import { makeUser, renderPage } from "../../test/render";
import type { Standing } from "../../types/scoring";
import { formatLongDate } from "../../utils/format";
import { MyActivityPage } from "./MyActivityPage";
import { MyCustomersPage } from "./MyCustomersPage";
import { ReferralPage } from "./ReferralPage";

const referral = {
  referral_code: "AGT-7K3Q9XMD",
  display_name: "Amina Otieno",
  link: "http://localhost:5173/join/AGT-7K3Q9XMD",
};
const message = `Register with Amina Otieno on SalesMesh: ${referral.link}`;

afterEach(cleanup);

async function renderReferral() {
  vi.spyOn(portalApi, "getMyReferral").mockResolvedValue(referral);
  renderPage(<ReferralPage />, { user: makeUser("agent") });
  await screen.findByTestId("referral-link");
}

describe("referral card", () => {
  it("shows the full link and builds every share link", async () => {
    await renderReferral();
    expect(screen.getByTestId("referral-link")).toHaveTextContent(
      referral.link,
    );
    const encoded = encodeURIComponent(message);
    expect(
      screen.getByRole("link", { name: "Share on WhatsApp" }),
    ).toHaveAttribute("href", `https://wa.me/?text=${encoded}`);
    expect(screen.getByRole("link", { name: "Send by SMS" })).toHaveAttribute(
      "href",
      `sms:?&body=${encoded}`,
    );
    const email = screen.getByRole("link", { name: "Send by email" });
    expect(email.getAttribute("href")).toMatch(/^mailto:\?subject=/);
    expect(email.getAttribute("href")).toContain(`&body=${encoded}`);
    expect(
      screen.getByRole("link", { name: "Register a customer on this device" }),
    ).toHaveAttribute("href", "/join/AGT-7K3Q9XMD");
  });

  it("copies the link to the clipboard", async () => {
    const input = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    await renderReferral();
    await input.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(referral.link);
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("shows a large QR code and downloads it as a PNG", async () => {
    const input = userEvent.setup();
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/png;base64,AAAA");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    await renderReferral();

    await input.click(screen.getByRole("button", { name: "Show QR code" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByLabelText("Large QR code for your registration link"),
    ).toBeInTheDocument();

    await input.click(
      screen.getByRole("button", { name: "Download QR as PNG", hidden: true }),
    );
    expect(toDataURL).toHaveBeenCalledWith("image/png");
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("salesmesh-AGT-7K3Q9XMD.png");
    expect(anchor.href).toBe("data:image/png;base64,AAAA");
  });
});

describe("my customers", () => {
  it("shows only name, registration date, and assisted", async () => {
    vi.spyOn(portalApi, "getMyCustomers").mockResolvedValue({
      items: [
        {
          full_name: "Wanjiru Kamau",
          registered_at: "2026-10-10T08:00:00Z",
          assisted: true,
        },
        {
          full_name: "Otieno Ouma",
          registered_at: "2026-10-11T08:00:00Z",
          assisted: false,
        },
      ],
      total: 2,
    });
    renderPage(<MyCustomersPage />, { user: makeUser("agent") });

    expect(await screen.findByText("Wanjiru Kamau")).toBeInTheDocument();
    const headers = screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      "Customer",
      "Registered",
      "Registered on my device",
    ]);
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /reputation|risk|band|status|probability|flag|verified|pending|rejected/i,
    );
  });
});

describe("my activity", () => {
  // The same words the backend tests prove absent from the agent API.
  const forbidden =
    /reputation|risk|band|score|probability|reason|flag|watch|insufficient|threshold|rejected|fake/i;

  function mockActivity(standing: Standing["standing"]) {
    vi.spyOn(portalApi, "getMyStanding").mockResolvedValue({
      standing,
      as_of: "2026-10-01",
    });
    vi.spyOn(portalApi, "getMyActivity").mockResolvedValue({
      as_of: "2026-10-01",
      months: [
        {
          month: "2026-08",
          registrations: 3,
          eligible: null,
          awaiting_verification: null,
        },
        {
          month: "2026-09",
          registrations: 40,
          eligible: 35,
          awaiting_verification: 5,
        },
      ],
    });
  }

  it.each([
    ["New agent", /once enough customers have registered/],
    ["Good standing", /Keep registering customers/],
    ["Account under review", /Your link keeps working/],
  ] as const)("shows %s with its explanation only", async (standing, text) => {
    mockActivity(standing);
    renderPage(<MyActivityPage />, { user: makeUser("agent") });

    const card = await screen.findByRole("region", { name: "My standing" });
    expect(await within(card).findByText(standing)).toBeInTheDocument();
    expect(within(card).getByText(text)).toBeInTheDocument();
    // The date follows the reader's locale (CI runs en-US, Kenya uses en-GB).
    expect(
      within(card).getByText(`As of ${formatLongDate("2026-10-01")}.`),
    ).toBeInTheDocument();
    expect(formatLongDate("2026-10-01")).toMatch(/2026/);
    expect(document.body).not.toHaveTextContent(forbidden);
  });

  it("shows monthly totals newest first and hides small breakdowns", async () => {
    mockActivity("Good standing");
    renderPage(<MyActivityPage />, { user: makeUser("agent") });

    const table = await screen.findByRole("table");
    const rows = (await within(table).findAllByRole("row")).slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["2026-09", "40", "35", "5"],
      [
        "2026-08",
        "3",
        "Shown from 10 registrations",
        "Shown from 10 registrations",
      ],
    ]);
    // Only these columns: no per-customer status or review state.
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Month", "Registrations", "Eligible", "Awaiting verification"]);
    expect(document.body).not.toHaveTextContent(/review/i);
  });
});
