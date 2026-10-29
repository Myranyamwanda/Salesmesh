import { cleanup, screen, within } from "@testing-library/react";
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
    });
    renderPage(<EligibilityPage />, { user: makeUser("admin") });
    const input = userEvent.setup();

    const totals = await screen.findByRole("region", {
      name: "Eligibility totals",
    });
    expect(await within(totals).findByText("5")).toBeInTheDocument();
    const [monthTable, agentTable] = screen.getAllByRole("table");
    const monthRows = within(monthTable).getAllByRole("row").slice(1);
    expect(monthRows.map((row) => row.firstChild?.textContent)).toEqual([
      "2026-10",
      "2026-09",
    ]);
    const cells = () =>
      within(within(agentTable).getByRole("row", { name: /Amina Otieno/ }))
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(cells()).toEqual(["Amina Otieno", "4", "1", "2"]);

    await input.click(screen.getByRole("combobox", { name: "Period" }));
    await input.click(screen.getByRole("option", { name: "2026-09" }));
    expect(cells()).toEqual(["Amina Otieno", "1", "0", "1"]);
  });
});
