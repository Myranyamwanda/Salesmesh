import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as portalApi from "../../api/portal";
import { makeUser, renderPage } from "../../test/render";
import { QualityDashboardPage } from "./QualityDashboardPage";

afterEach(cleanup);

describe("client quality dashboard", () => {
  it("shows the quality figures and the monthly trend", async () => {
    vi.spyOn(portalApi, "getQuality").mockResolvedValue({
      registrations: 40,
      flagged: 6,
      flagged_percent: 15,
      confirmed_fake: 2,
      confirmed_fake_percent: 5,
      pending_review: 3,
      trend: [
        { month: "2026-09", registrations: 15, flagged: 2, confirmed_fake: 1 },
        { month: "2026-10", registrations: 25, flagged: 4, confirmed_fake: 1 },
      ],
    });
    renderPage(<QualityDashboardPage />, { user: makeUser("client") });

    const kpis = await screen.findByRole("region", {
      name: "Registration quality",
    });
    expect(await within(kpis).findByText("40")).toBeInTheDocument();
    expect(within(kpis).getByText("15%")).toBeInTheDocument();
    expect(within(kpis).getByText("5%")).toBeInTheDocument();
    expect(within(kpis).getByText("3")).toBeInTheDocument();
    const october = screen.getByRole("row", { name: /2026-10/ });
    expect(
      within(october)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["2026-10", "25", "4", "1"]);
    expect(screen.getByText("Monthly trend")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /probability|reason|reputation/i,
    );
  });
});
