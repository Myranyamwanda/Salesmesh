import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "../../api/admin";
import * as scoringApi from "../../api/scoring";
import { httpError, makeUser, renderPage } from "../../test/render";
import type {
  AgentDetail,
  AgentRanking,
  AssessmentDetail,
  ModelStatus,
  QueueItem,
  ScoringConfigRead,
} from "../../types/scoring";
import { AgentDetailPage } from "./AgentDetailPage";
import { AgentsPage } from "./AgentsPage";
import { ModelPage } from "./ModelPage";
import { ReviewQueuePage } from "./ReviewQueuePage";
import { SettingsPage } from "./SettingsPage";

const admin = makeUser("admin");

const ruleReason = {
  source: "rule" as const,
  code: "rule__device_distinct_emails_8w",
  text: "This device was used for 3 different email addresses in 8 weeks",
};
const modelReason = {
  source: "model" as const,
  code: "num__missingindicator_prev_address_months_count",
  text: "No previous address provided",
  contribution: 0.45,
};

const queueItem: QueueItem = {
  assessment_id: "assessment-1",
  created_at: "2026-10-10T08:00:00Z",
  probability: 0.0612,
  threshold: 0.035,
  reasons: [ruleReason, modelReason],
  customer_name: "Wanjiru Kamau",
  agent: { id: "agent-1", display_name: "Amina Otieno" },
};

const assessment: AssessmentDetail = {
  id: "assessment-1",
  model_version: "v1",
  probability: 0.0612,
  threshold: 0.035,
  flagged: true,
  reasons: [ruleReason, modelReason],
  features: { device_os: "windows", prev_address_months_count: null },
  created_at: "2026-10-10T08:00:00Z",
  customer: {
    id: "customer-1",
    full_name: "Wanjiru Kamau",
    email: "wanjiru@gmail.com",
    mobile_phone: "0712345678",
    secondary_phone: null,
    date_of_birth: "1995-05-17",
    country: "KE",
    current_address_months: 24,
    previous_address_months: null,
    assisted: false,
    status: "pending_review",
    created_at: "2026-10-10T08:00:00Z",
  },
  agent: { id: "agent-1", display_name: "Amina Otieno" },
  review: null,
};

function agent(overrides: Partial<AgentRanking>): AgentRanking {
  return {
    id: "agent-1",
    display_name: "Amina Otieno",
    email: "amina@example.com",
    referral_code: "AGT-7K3Q9XMD",
    status: "approved",
    is_active: true,
    client: null,
    n_users: 40,
    flags: 2,
    confirmed_fake: 1,
    pending_review: 1,
    assisted_share: 0.25,
    reputation: 94.5,
    risk_score: 5.5,
    band: "Low risk",
    ...overrides,
  };
}

const agents = [
  agent({
    id: "a",
    display_name: "Amina",
    reputation: 88.1,
    band: "High risk",
  }),
  agent({ id: "b", display_name: "Brian", reputation: 91.0, band: "Watch" }),
  agent({ id: "c", display_name: "Chebet", reputation: 95.2 }),
  agent({
    id: "d",
    display_name: "Daudi",
    reputation: 94.6,
    n_users: 3,
    band: "Insufficient data",
  }),
];

afterEach(cleanup);

// The Model page also loads the monitoring card; give it an empty history.
beforeEach(() => {
  vi.spyOn(scoringApi, "getMonitoring").mockResolvedValue({
    p0: 0.0539,
    months: [],
  });
});

function rowNames() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);
}

describe("review queue", () => {
  it("shows reasons with a Model or Rule label", async () => {
    vi.spyOn(scoringApi, "getReviewQueue").mockResolvedValue({
      items: [queueItem],
      total: 1,
    });
    renderPage(<ReviewQueuePage />, { user: admin });

    expect(await screen.findByText("Wanjiru Kamau")).toBeInTheDocument();
    expect(screen.getByText("6.1%")).toBeInTheDocument();
    const reasons = screen.getAllByRole("listitem");
    expect(reasons[0]).toHaveTextContent("Rule");
    expect(reasons[0]).toHaveTextContent(ruleReason.text);
    expect(reasons[1]).toHaveTextContent("Model");
    expect(reasons[1]).toHaveTextContent(modelReason.text);
  });

  it("records a decision with notes", async () => {
    const input = userEvent.setup();
    vi.spyOn(scoringApi, "getReviewQueue").mockResolvedValue({
      items: [queueItem],
      total: 1,
    });
    vi.spyOn(scoringApi, "getAssessment").mockResolvedValue(assessment);
    const review = vi.spyOn(scoringApi, "reviewAssessment").mockResolvedValue({
      id: "review-1",
      decision: "confirmed_fake",
      notes: "Called the number",
      reviewer_id: admin.id,
      created_at: "2026-10-11T08:00:00Z",
    });
    renderPage(<ReviewQueuePage />, { user: admin });

    await input.click(await screen.findByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("wanjiru@gmail.com")).toBeVisible();
    expect(within(dialog).getByText("Missing")).toBeInTheDocument();
    await input.type(
      within(dialog).getByLabelText("Notes (optional)"),
      "Called the number",
    );
    await input.click(
      within(dialog).getByRole("button", { name: "Confirm fake" }),
    );

    await waitFor(() =>
      expect(review).toHaveBeenCalledWith(
        "assessment-1",
        "confirmed_fake",
        "Called the number",
      ),
    );
  });

  it("shows why a review failed", async () => {
    const input = userEvent.setup();
    vi.spyOn(scoringApi, "getReviewQueue").mockResolvedValue({
      items: [queueItem],
      total: 1,
    });
    vi.spyOn(scoringApi, "getAssessment").mockResolvedValue(assessment);
    vi.spyOn(scoringApi, "reviewAssessment").mockRejectedValue(
      httpError(409, "This assessment has already been reviewed"),
    );
    renderPage(<ReviewQueuePage />, { user: admin });

    await input.click(await screen.findByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog");
    await input.click(
      await within(dialog).findByRole("button", { name: "Confirm real" }),
    );
    expect(
      await within(dialog).findByText(
        "This assessment has already been reviewed",
      ),
    ).toBeInTheDocument();
  });
});

describe("agents ranking", () => {
  it("lists agents worst first and sorts by reputation", async () => {
    const input = userEvent.setup();
    vi.spyOn(scoringApi, "listAgents").mockResolvedValue(agents);
    renderPage(<AgentsPage />, { user: admin });

    await screen.findByText("Amina");
    expect(rowNames()).toEqual(["Amina", "Brian", "Daudi", "Chebet"]);
    await input.click(screen.getByRole("button", { name: "Reputation" }));
    expect(rowNames()).toEqual(["Chebet", "Daudi", "Brian", "Amina"]);
    await input.click(screen.getByRole("button", { name: "Customers" }));
    expect(rowNames()[0]).toBe("Daudi");
  });

  it("shows every band as a text badge and filters by band", async () => {
    const input = userEvent.setup();
    vi.spyOn(scoringApi, "listAgents").mockResolvedValue(agents);
    renderPage(<AgentsPage />, { user: admin });

    await screen.findByText("Amina");
    for (const band of [
      "High risk",
      "Watch",
      "Low risk",
      "Insufficient data",
    ]) {
      expect(
        within(screen.getByRole("table")).getByText(band),
      ).toBeInTheDocument();
    }
    // Assisted share is shown for each of the four agents.
    expect(screen.getAllByText("25%")).toHaveLength(4);

    await input.click(screen.getByRole("combobox", { name: "Band" }));
    await input.click(screen.getByRole("option", { name: "Watch" }));
    expect(rowNames()).toEqual(["Brian"]);
  });
});

describe("agent detail", () => {
  const detail: AgentDetail = {
    ...agent({ client: null }),
    customers: [],
    customers_total: 0,
  };

  it("assigns and removes a client", async () => {
    const input = userEvent.setup();
    vi.spyOn(scoringApi, "getAgent").mockResolvedValue(detail);
    vi.spyOn(adminApi, "listUsers").mockResolvedValue({
      items: [admin, makeUser("client", { id: "client-1" })],
      total: 2,
    });
    const update = vi
      .spyOn(scoringApi, "updateAgent")
      .mockResolvedValue(detail);
    renderPage(<AgentDetailPage />, {
      path: "/admin/agents/:agentId",
      route: "/admin/agents/agent-1",
      user: admin,
    });

    await screen.findByRole("heading", { name: "Amina Otieno" });
    await input.click(screen.getByRole("combobox", { name: "Client" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "No client",
      "client@example.com",
    ]);
    await input.click(
      screen.getByRole("option", { name: "client@example.com" }),
    );
    await input.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("agent-1", {
        display_name: "Amina Otieno",
        client_id: "client-1",
      }),
    );

    await input.click(screen.getByRole("combobox", { name: "Client" }));
    await input.click(await screen.findByRole("option", { name: "No client" }));
    await input.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith("agent-1", {
        display_name: "Amina Otieno",
        client_id: null,
      }),
    );
  });
});

describe("model page", () => {
  const model: ModelStatus = {
    status: "ok",
    error: null,
    source: "local",
    loaded_at: "2026-10-15T08:00:00Z",
    model_name: "salesmesh-fake-user-detector",
    model_version: "v1",
    model_type: "LogisticRegression + sigmoid calibration",
    sklearn_version: "1.7.2",
    threshold: 0.035,
    metrics: { "ROC-AUC": 0.8165, TP: 989 },
    golden_check: {
      passed: true,
      checked: 20,
      failed: 0,
      max_difference: 4.96e-7,
      tolerance: 1e-5,
    },
  };

  it("shows the version, threshold, metrics, and golden check", async () => {
    vi.spyOn(scoringApi, "getModel").mockResolvedValue(model);
    renderPage(<ModelPage />, { user: admin });

    expect(await screen.findByText("v1")).toBeInTheDocument();
    expect(screen.getByText("3.5%")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText(/20 of 20 within 0.00001/)).toBeInTheDocument();
    expect(screen.getByText("0.8165")).toBeInTheDocument();
    expect(screen.getByText("989")).toBeInTheDocument();
  });

  it("shows why a reload failed", async () => {
    const input = userEvent.setup();
    vi.spyOn(scoringApi, "getModel").mockResolvedValue(model);
    vi.spyOn(scoringApi, "reloadModel").mockRejectedValue(
      httpError(
        409,
        "Reload failed; the current model is still in use. Model file not found: metadata.json",
      ),
    );
    renderPage(<ModelPage />, { user: admin });

    await input.click(
      await screen.findByRole("button", { name: "Reload model" }),
    );
    await input.click(await screen.findByRole("button", { name: "Reload" }));
    expect(
      await screen.findByText(/the current model is still in use/),
    ).toBeInTheDocument();
  });
});

describe("settings page", () => {
  const config: ScoringConfigRead = {
    p0: 0.0539,
    k: 10,
    min_users_for_band: 30,
    high_risk_below: 90,
    watch_below: 92,
    device_email_rule_min: 3,
    updated_at: "2026-10-15T08:00:00Z",
    updated_by: null,
  };

  async function renderSettings() {
    vi.spyOn(scoringApi, "getScoringConfig").mockResolvedValue(config);
    renderPage(<SettingsPage />, { user: admin });
    await waitFor(() =>
      expect(screen.getByLabelText("Expected flag rate (p0)")).toHaveValue(
        "0.0539",
      ),
    );
  }

  async function replace(label: string, value: string) {
    const input = userEvent.setup();
    const field = screen.getByLabelText(label);
    await input.clear(field);
    await input.type(field, value);
    return input;
  }

  it("explains every setting", async () => {
    await renderSettings();
    expect(
      screen.getByText(/Expected share of flagged customers/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/How many 'average' customers/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Insufficient data/)).toBeInTheDocument();
    expect(
      screen.getByText("A reputation below this is High risk."),
    ).toBeVisible();
    expect(screen.getByText(/at or above it is Low risk/)).toBeInTheDocument();
    expect(
      screen.getByText(/one device was used for at least this many/),
    ).toBeInTheDocument();
  });

  it.each([
    ["Watch below", "85", "Must be at least the High risk limit"],
    ["Device email rule", "2", "Must be a whole number of at least 3"],
    ["Expected flag rate (p0)", "1.5", "Must be between 0 and 1"],
    ["Smoothing strength (k)", "0", "Must be greater than 0"],
  ])("rejects %s = %s", async (label, value, message) => {
    const save = vi.spyOn(scoringApi, "updateScoringConfig");
    await renderSettings();
    const input = await replace(label, value);
    await input.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("saves all six settings as numbers", async () => {
    const save = vi
      .spyOn(scoringApi, "updateScoringConfig")
      .mockResolvedValue({ ...config, device_email_rule_min: 4 });
    await renderSettings();
    const input = await replace("Device email rule", "4");
    await input.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(save.mock.calls[0][0]).toEqual({
        p0: 0.0539,
        k: 10,
        min_users_for_band: 30,
        high_risk_below: 90,
        watch_below: 92,
        device_email_rule_min: 4,
      }),
    );
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
  });
});
