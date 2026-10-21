import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as portalApi from "../../api/portal";
import { makeUser, renderPage } from "../../test/render";
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
