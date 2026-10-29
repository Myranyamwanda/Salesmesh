import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "../../api/admin";
import * as scoringApi from "../../api/scoring";
import { makeUser, renderPage } from "../../test/render";
import type { AgentDetail, AgentMonthKpi, MonthKpi } from "../../types/scoring";
import { AgentDetailPage } from "./AgentDetailPage";
import { OverviewPage } from "./OverviewPage";

const admin = makeUser("admin");

function month(value: string, overrides: Partial<MonthKpi> = {}): MonthKpi {
  return {
    month: value,
    registrations: 0,
    flagged: 0,
    confirmed_fake: 0,
    reviewed: 0,
    confirmed_real: 0,
    eligible: 0,
    flag_rate: null,
    confirmed_fake_rate: null,
    verification_rate: null,
    avg_hours_to_review: null,
    ...overrides,
  };
}

function agentMonth(
  value: string,
  overrides: Partial<AgentMonthKpi> = {},
): AgentMonthKpi {
  return {
    ...month(value),
    n_users_to_date: 0,
    reputation: null,
    ...overrides,
  };
}

// The August row of the backend's hand-calculated test dataset.
const august = agentMonth("2026-08", {
  registrations: 4,
  flagged: 2,
  confirmed_fake: 1,
  reviewed: 2,
  confirmed_real: 1,
  eligible: 3,
  flag_rate: 0.5,
  confirmed_fake_rate: 0.25,
  verification_rate: 0.5,
  avg_hours_to_review: 180,
  n_users_to_date: 4,
  reputation: 81.9,
});

const detail: AgentDetail = {
  id: "agent-1",
  display_name: "Amina Otieno",
  email: "amina@example.com",
  referral_code: "AGT-7K3Q9XMD",
  status: "approved",
  is_active: true,
  client: null,
  link_active: false,
  n_users: 4,
  flags: 2,
  confirmed_fake: 1,
  pending_review: 1,
  assisted_share: 0,
  reputation: 81.9,
  risk_score: 18.1,
  band: "Insufficient data",
  customers: [],
  customers_total: 0,
};

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(scoringApi, "getAgent").mockResolvedValue(detail);
  vi.spyOn(adminApi, "listClients").mockResolvedValue([]);
  vi.spyOn(scoringApi, "getModel").mockResolvedValue({
    status: "ok",
    error: null,
    model_version: "v1",
    sklearn_version: "1.7.2",
    threshold: 0.035,
    metrics: {},
    golden_check: null,
  } as unknown as Awaited<ReturnType<typeof scoringApi.getModel>>);
  vi.spyOn(scoringApi, "getReviewQueue").mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(scoringApi, "listAgents").mockResolvedValue([]);
});

function cells(table: HTMLElement, name: RegExp) {
  return within(within(table).getByRole("row", { name }))
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

describe("agent KPIs", () => {
  it("shows monthly KPIs newest first, with dashes for empty months", async () => {
    vi.spyOn(scoringApi, "getAgentKpis").mockResolvedValue({
      agent: { id: "agent-1", display_name: "Amina Otieno" },
      months: [agentMonth("2026-07"), august],
    });
    renderPage(<AgentDetailPage />, {
      path: "/admin/agents/:agentId",
      route: "/admin/agents/agent-1",
      user: admin,
    });

    const section = await screen.findByRole("region", { name: "Monthly KPIs" });
    const table = await within(section).findByRole("table");
    expect(cells(table, /2026-08/)).toEqual([
      "2026-08",
      "4",
      "50.0%",
      "25.0%",
      "50.0%",
      "7.5 days",
      "3",
      "81.9",
    ]);
    expect(cells(table, /2026-07/)).toEqual([
      "2026-07",
      "0",
      "—",
      "—",
      "—",
      "—",
      "0",
      "—",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("2026-08");
    expect(
      within(section).getByRole("heading", { name: "Reputation at month end" }),
    ).toBeInTheDocument();
  });

  it("shows an honest empty state before the first registration", async () => {
    vi.spyOn(scoringApi, "getAgentKpis").mockResolvedValue({
      agent: { id: "agent-1", display_name: "Amina Otieno" },
      months: [agentMonth("2026-09"), agentMonth("2026-10")],
    });
    renderPage(<AgentDetailPage />, {
      path: "/admin/agents/:agentId",
      route: "/admin/agents/agent-1",
      user: admin,
    });
    expect(await screen.findByText("No registrations yet")).toBeInTheDocument();
  });
});

describe("network KPIs", () => {
  it("benchmarks agents against the network flag rate", async () => {
    vi.spyOn(scoringApi, "getNetworkKpis").mockResolvedValue({
      months: [
        month("2026-10", {
          registrations: 13,
          flagged: 5,
          flag_rate: 0.3846,
          eligible: 6,
        }),
      ],
      network_flag_rate: 0.3846,
      min_registrations: 30,
      benchmark: [
        {
          agent: { id: "a", display_name: "Amina Otieno" },
          registrations: 40,
          flag_rate: 0.4545,
          difference: 0.0699,
          enough_data: true,
        },
        {
          agent: { id: "b", display_name: "Brian Mwangi" },
          registrations: 32,
          flag_rate: 0.3,
          difference: -0.0846,
          enough_data: true,
        },
        {
          agent: { id: "c", display_name: "Chebet" },
          registrations: 2,
          flag_rate: 0,
          difference: -0.3846,
          enough_data: false,
        },
      ],
    });
    renderPage(<OverviewPage />, { user: admin });

    const section = await screen.findByRole("region", { name: "Network KPIs" });
    expect(
      await within(section).findByText(/against the network\s+rate \(38\.5%\)/),
    ).toBeInTheDocument();
    const [monthTable, benchmark] = within(section).getAllByRole("table");
    expect(cells(monthTable, /2026-10/).slice(0, 3)).toEqual([
      "2026-10",
      "13",
      "38.5%",
    ]);
    expect(cells(benchmark, /Amina/)).toEqual([
      "Amina Otieno",
      "40",
      "45.5%",
      "+7.0 pts",
    ]);
    expect(cells(benchmark, /Brian/)[3]).toBe("-8.5 pts");
    expect(cells(benchmark, /Chebet/)[3]).toBe("Insufficient data");
  });
});
