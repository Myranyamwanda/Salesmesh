import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "../auth/context";
import { RiskBadge } from "../components/DataComponents";
import { WorkspaceLayout } from "../layouts/WorkspaceLayout";
import type { AuthContextValue } from "../auth/context";
import type { AuthUser } from "../types/auth";
import {
  AdminOverviewPage,
  AgentsListPage,
  AgentDetailPage,
  AgentTasksPage,
  ClientDashboardPage,
  ClientReportsPage,
  ModelManagementPage,
  ReviewQueuePage,
  SystemSettingsPage,
} from "./WorkspacePages";

const admin: AuthUser = {
  id: "admin-id",
  email: "admin@example.com",
  role: "admin",
  status: "approved",
  is_active: true,
  email_verified_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
};

const auth: AuthContextValue = {
  user: admin,
  isLoading: false,
  login: async () => admin,
  logout: async () => undefined,
  logoutAll: async () => undefined,
  clearSession: () => undefined,
};

afterEach(cleanup);

describe("dataset-dependent workspace pages", () => {
  it.each([
    {
      name: "admin overview",
      Page: AdminOverviewPage,
      message: "No data yet - the scoring model is not connected.",
    },
    {
      name: "agent list",
      Page: AgentsListPage,
      message:
        "No data yet - agent data will appear after the dataset and model are approved.",
    },
    {
      name: "agent detail",
      Page: AgentDetailPage,
      message:
        "This page will use the selected dataset; no agent fields have been defined.",
    },
    {
      name: "review queue",
      Page: ReviewQueuePage,
      message:
        "No data yet - flagged records will appear when the scoring model is connected.",
    },
    {
      name: "model management",
      Page: ModelManagementPage,
      message: "Model versions, thresholds, and metrics are not available yet.",
    },
    {
      name: "system settings",
      Page: SystemSettingsPage,
      message: "No additional system settings are exposed in this phase.",
    },
    {
      name: "agent tasks",
      Page: AgentTasksPage,
      message: "No data yet - your onboarding workspace is not connected.",
    },
    {
      name: "client dashboard",
      Page: ClientDashboardPage,
      message: "No data yet - the scoring model is not connected.",
    },
    {
      name: "client reports",
      Page: ClientReportsPage,
      message: "No data yet - onboarding reports are not connected.",
    },
  ])("shows a clear empty state for $name", ({ Page, message }) => {
    render(<Page />);
    expect(screen.getAllByText(message).length).toBeGreaterThan(0);
  });
});

describe("workspace navigation", () => {
  it("shows administrator pages and account links within the role shell", () => {
    render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={["/admin/users"]}>
          <Routes>
            <Route element={<WorkspaceLayout role="admin" />}>
              <Route
                path="/admin/users"
                element={<div>User management content</div>}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.getByText("User management content")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Overview" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: "Audit log" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: "My profile" }).length,
    ).toBeGreaterThan(0);
  });

  it("renders supplied risk scores without assigning invented severity bands", () => {
    render(<RiskBadge value={52} />);
    const badge = screen.getByText("Risk score: 52");
    expect(badge).toHaveClass("risk-badge", "risk-value");
    expect(badge).not.toHaveClass("risk-high", "risk-medium", "risk-low");
  });
});
