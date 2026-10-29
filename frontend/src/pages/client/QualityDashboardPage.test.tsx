import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as portalApi from "../../api/portal";
import { makeUser, renderPage } from "../../test/render";
import { QualityDashboardPage } from "./QualityDashboardPage";

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(portalApi, "getClientEligibility").mockResolvedValue({
    eligible: 30,
    pending: 3,
    not_eligible: 2,
    agents: [
      { display_name: "Amina Otieno", eligible: 20, not_eligible: 2 },
      { display_name: "Brian Mwangi", eligible: 10, not_eligible: 0 },
    ],
  });
});

describe("client quality dashboard", () => {
  it("shows the quality figures and the monthly trend", async () => {
    vi.spyOn(portalApi, "getQuality").mockResolvedValue({
      registrations: 40,
      confirmed_fake: 2,
      confirmed_fake_percent: 5,
      under_review: 3,
      trend: [
        {
          month: "2026-08",
          registrations: 0,
          confirmed_fake: 0,
          confirmed_fake_percent: null,
        },
        {
          month: "2026-09",
          registrations: 15,
          confirmed_fake: 1,
          confirmed_fake_percent: 6.7,
        },
        {
          month: "2026-10",
          registrations: 25,
          confirmed_fake: 1,
          confirmed_fake_percent: 4,
        },
      ],
    });
    renderPage(<QualityDashboardPage />, { user: makeUser("client") });

    const kpis = await screen.findByRole("region", {
      name: "Registration quality",
    });
    expect(await within(kpis).findByText("40")).toBeInTheDocument();
    expect(within(kpis).getByText("5%")).toBeInTheDocument();
    expect(within(kpis).getByText("3")).toBeInTheDocument();
    const october = screen.getByRole("row", { name: /2026-10/ });
    expect(
      within(october)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["2026-10", "25", "1", "4%"]);
    const august = screen.getByRole("row", { name: /2026-08/ });
    expect(within(august).getAllByRole("cell")[3]).toHaveTextContent("—");
    expect(screen.getByText("Monthly trend")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /flag|probability|reason|reputation/i,
    );
  });

  it("shows eligibility per agent with pending only as a total", async () => {
    vi.spyOn(portalApi, "getQuality").mockResolvedValue({
      registrations: 35,
      confirmed_fake: 2,
      confirmed_fake_percent: 5.7,
      under_review: 3,
      trend: [],
    });
    renderPage(<QualityDashboardPage />, { user: makeUser("client") });

    const section = await screen.findByRole("region", {
      name: "Commission eligibility",
    });
    expect(await within(section).findByText("30")).toBeInTheDocument();
    expect(
      within(section).getByText("Awaiting verification"),
    ).toBeInTheDocument();
    const amina = within(section).getByRole("row", { name: /Amina Otieno/ });
    expect(
      within(amina)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["Amina Otieno", "20", "2"]);
    // No per-agent pending column.
    expect(
      within(section)
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["Agent", "Eligible", "Not eligible"]);
  });
});
