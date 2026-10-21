import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import * as adminApi from "../api/admin";
import { AuthContext, type AuthContextValue } from "../auth/context";
import { AdminAuditLogPage } from "./AdminAuditLogPage";
import { AdminUserManagementPage } from "./AdminUserManagementPage";
import type { AuthUser } from "../types/auth";

const adminUser: AuthUser = {
  id: "admin-id",
  email: "admin@example.com",
  role: "admin",
  status: "approved",
  is_active: true,
  email_verified_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
};

const pendingAgent: AuthUser = {
  id: "agent-id",
  email: "pending@example.com",
  role: "agent",
  status: "pending",
  is_active: true,
  email_verified_at: null,
  created_at: "2026-02-01T00:00:00Z",
};

const authValue: AuthContextValue = {
  user: adminUser,
  isLoading: false,
  login: vi.fn(async () => adminUser),
  logout: vi.fn(async () => undefined),
  logoutAll: vi.fn(async () => undefined),
  clearSession: vi.fn(),
};

function renderAdmin(element: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{element}</MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("admin user management", () => {
  it("lists authentication accounts and approves a pending agent", async () => {
    vi.spyOn(adminApi, "listUsers").mockResolvedValue({
      items: [adminUser, pendingAgent],
      total: 2,
    });
    const approve = vi.spyOn(adminApi, "approveAgent").mockResolvedValue({
      ...pendingAgent,
      status: "approved",
    });
    vi.spyOn(adminApi, "rejectAgent").mockResolvedValue(pendingAgent);
    vi.spyOn(adminApi, "setUserActive").mockResolvedValue(pendingAgent);
    vi.spyOn(adminApi, "setUserRole").mockResolvedValue(pendingAgent);

    renderAdmin(<AdminUserManagementPage />);

    expect(await screen.findByText(adminUser.email)).toBeInTheDocument();
    expect(screen.getByText(pendingAgent.email)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: `Approve ${pendingAgent.email}` }),
    );
    await waitFor(() => expect(approve).toHaveBeenCalledWith(pendingAgent.id));
    expect(
      await screen.findByText("Agent account approved."),
    ).toBeInTheDocument();
  });

  it("creates an admin account using only the authentication API", async () => {
    vi.spyOn(adminApi, "listUsers").mockResolvedValue({
      items: [adminUser],
      total: 1,
    });
    const create = vi.spyOn(adminApi, "createUser").mockResolvedValue({
      ...adminUser,
      id: "new-admin-id",
      email: "new-admin@example.com",
      email_verified_at: null,
    });
    vi.spyOn(adminApi, "approveAgent").mockResolvedValue(pendingAgent);
    vi.spyOn(adminApi, "rejectAgent").mockResolvedValue(pendingAgent);
    vi.spyOn(adminApi, "setUserActive").mockResolvedValue(adminUser);
    vi.spyOn(adminApi, "setUserRole").mockResolvedValue(adminUser);

    renderAdmin(<AdminUserManagementPage />);
    const interaction = userEvent.setup();
    await interaction.click(
      await screen.findByRole("button", { name: "Create account" }),
    );
    await interaction.type(
      screen.getByLabelText("Email address"),
      "new-admin@example.com",
    );
    await interaction.type(
      screen.getByLabelText("Temporary password"),
      "Strong-Passphrase123!",
    );
    const createButtons = screen.getAllByRole("button", {
      name: "Create account",
    });
    await interaction.click(createButtons[createButtons.length - 1]);

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        email: "new-admin@example.com",
        role: "client",
        password: "Strong-Passphrase123!",
      }),
    );
  });

  it("changes an account role and activation state through admin APIs", async () => {
    vi.spyOn(adminApi, "listUsers").mockResolvedValue({
      items: [adminUser, pendingAgent],
      total: 2,
    });
    const setRole = vi.spyOn(adminApi, "setUserRole").mockResolvedValue({
      ...pendingAgent,
      role: "client",
      status: "approved",
    });
    const setActive = vi
      .spyOn(adminApi, "setUserActive")
      .mockResolvedValue({ ...pendingAgent, is_active: false });
    vi.spyOn(adminApi, "approveAgent").mockResolvedValue(pendingAgent);
    vi.spyOn(adminApi, "rejectAgent").mockResolvedValue(pendingAgent);

    renderAdmin(<AdminUserManagementPage />);
    const interaction = userEvent.setup();
    const row = await screen.findByRole("row", { name: /pending@example.com/ });

    await interaction.click(
      within(row).getByRole("combobox", { name: "Role" }),
    );
    await interaction.click(
      await screen.findByRole("option", { name: "Client" }),
    );
    await waitFor(() =>
      expect(setRole).toHaveBeenCalledWith(pendingAgent.id, "client"),
    );

    await interaction.click(
      within(row).getByRole("switch", {
        name: `Deactivate ${pendingAgent.email}`,
      }),
    );
    await waitFor(() =>
      expect(setActive).toHaveBeenCalledWith(pendingAgent.id, false),
    );
  });
});

describe("admin audit log", () => {
  it("shows audit events while excluding non-response sensitive fields", async () => {
    vi.spyOn(adminApi, "listAuditLogs").mockResolvedValue({
      items: [
        {
          id: "audit-id",
          actor_user_id: adminUser.id,
          target_user_id: pendingAgent.id,
          subject: null,
          action: "agent_approved",
          outcome: "success",
          request_id: "request-id",
          created_at: "2026-03-01T12:00:00Z",
        },
      ],
      total: 1,
    });

    renderAdmin(<AdminAuditLogPage />);

    expect(await screen.findByText("agent approved")).toBeInTheDocument();
    expect(screen.getByText(adminUser.id)).toBeInTheDocument();
    expect(screen.queryByText("private-ip-hash")).not.toBeInTheDocument();
    expect(screen.queryByText("hidden-password")).not.toBeInTheDocument();
  });
});
