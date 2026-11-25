import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as scoringApi from "../../api/scoring";
import { makeUser, renderPage } from "../../test/render";
import type { MonthEligibility } from "../../types/scoring";
import { EligibilityPage } from "./EligibilityPage";

afterEach(cleanup);

function month(
  value: string,
  eligible: number,
  pending: number,
  notEligible: number,
): MonthEligibility {
  return { month: value, eligible, pending, not_eligible: notEligible };
}

describe("commission eligibility", () => {
  it("shows totals, months newest first, and agents per period", async () => {
    vi.spyOn(scoringApi, "getEligibility").mockResolvedValue({
      totals: { eligible: 5, pending: 1, not_eligible: 2 },
      months: [month("2026-09", 1, 0, 1), month("2026-10", 3, 1, 0)],
      agents: [
        {
          agent: { id: "a", display_name: "Amina Otieno" },
          totals: { eligible: 4, pending: 1, not_eligible: 2 },
          months: [month("2026-09", 1, 0, 1), month("2026-10", 2, 1, 0)],
        },
        {
          agent: { id: "b", display_name: "Brian Mwangi" },
          totals: { eligible: 1, pending: 0, not_eligible: 0 },
          months: [month("2026-09", 0, 0, 0), month("2026-10", 1, 0, 0)],
        },
      ],
      agents_total: 2,
    });
    renderPage(<EligibilityPage />, { user: makeUser("admin") });
    const input = userEvent.setup();

    const totals = await screen.findByRole("region", {
      name: "Eligibility totals",
    });
    expect(await within(totals).findByText("5")).toBeInTheDocument();
    const [monthTable] = screen.getAllByRole("table");
    const agentTable = () => screen.getAllByRole("table")[1];
    const monthRows = within(monthTable).getAllByRole("row").slice(1);
    expect(monthRows.map((row) => row.firstChild?.textContent)).toEqual([
      "2026-10",
      "2026-09",
    ]);
    const cells = () =>
      within(within(agentTable()).getByRole("row", { name: /Amina Otieno/ }))
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(cells()).toEqual(["Amina Otieno", "4", "1", "2"]);

    await input.click(screen.getByRole("combobox", { name: "Period" }));
    await input.click(screen.getByRole("option", { name: "2026-09" }));
    expect(cells()).toEqual(["Amina Otieno", "1", "0", "1"]);

    // An agent's row opens every month for that agent.
    await input.click(
      within(agentTable()).getByRole("link", { name: "Amina Otieno" }),
    );
    const drawer = await screen.findByRole("dialog", { name: "Amina Otieno" });
    expect(drawer).toHaveTextContent(
      "2026-102 eligible · 1 pending · 0 not eligible",
    );
    expect(
      within(drawer).getByRole("link", { name: /Open agent detail/ }),
    ).toHaveAttribute("href", "/admin/agents/a");
  });

  it("searches and pages agents on the server", async () => {
    const report = vi.spyOn(scoringApi, "getEligibility").mockResolvedValue({
      totals: { eligible: 0, pending: 0, not_eligible: 0 },
      months: [],
      agents: [],
      agents_total: 0,
    });
    renderPage(<EligibilityPage />, {
      user: makeUser("admin"),
      route: "/?size=10&page=3",
    });
    const input = userEvent.setup();

    await screen.findAllByText("No agents yet");
    expect(report).toHaveBeenCalledWith({ offset: 20, limit: 10, q: "" });
    await input.type(screen.getByLabelText("Search agents"), "amina");
    await waitFor(() =>
      expect(report).toHaveBeenLastCalledWith({
        offset: 0,
        limit: 10,
        q: "amina",
      }),
    );
  });
});
