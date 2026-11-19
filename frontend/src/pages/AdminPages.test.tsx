import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import * as adminApi from "../api/admin";
import { AuthContext, type AuthContextValue } from "../auth/context";
import * as firebase from "../auth/firebase";
import { AdminAuditLogPage } from "./AdminAuditLogPage";
import { AdminUserManagementPage } from "./AdminUserManagementPage";
import type { AuthUser } from "../types/auth";

vi.mock("../auth/firebase", () => ({
  sendPasswordReset: vi.fn(async () => undefined),
}));

const adminUser: AuthUser = {
  id: "admin-id",
  email: "admin@example.com",
  role: "admin",
  status: "approved",
  is_active: true,
  email_verified_at: "2026-01-01T00:00:00Z",
  firebase_linked: true,
  created_at: "2026-01-01T00:00:00Z",
};

const pendingAgent: AuthUser = {
  id: "agent-id",
  email: "pending@example.com",
  role: "agent",
  status: "pending",
  is_active: true,
  email_verified_at: null,
  firebase_linked: true,
  created_at: "2026-02-01T00:00:00Z",
};

const authValue: AuthContextValue = {
  user: adminUser,
  isLoading: false,
  startSession: vi.fn(async () => adminUser),
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

/** Open an account's drawer, where its role and access are changed. */
async function openAccount(email: string) {
  await userEvent.click(
    await screen.findByRole("button", { name: new RegExp(`^${email}`) }),
  );
  return screen.findByRole("dialog", { name: email });
}

describe("admin user management", () => {
  beforeEach(() => {
    vi.spyOn(adminApi, "listClients").mockResolvedValue([]);
  });

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
    const row = screen.getByText(pendingAgent.email).closest("tr")!;
    expect(row).toHaveTextContent("Pending");
    const drawer = await openAccount(pendingAgent.email);
    await userEvent.click(
      within(drawer).getByRole("button", {
        name: `Approve ${pendingAgent.email}`,
      }),
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
      firebase_linked: true,
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
      screen.getByLabelText("Organisation name"),
      " Acme Bank ",
    );
    // No password field: the person sets their own from Firebase's email.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    const createButtons = screen.getAllByRole("button", {
      name: "Create account",
    });
    await interaction.click(createButtons[createButtons.length - 1]);

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        email: "new-admin@example.com",
        role: "client",
        organisation_name: "Acme Bank",
      }),
    );
    expect(firebase.sendPasswordReset).toHaveBeenCalledWith(
      "new-admin@example.com",
    );
    expect(
      await screen.findByText(/“set your password” email was sent/),
    ).toBeInTheDocument();
  });

  it("reports a created account whose password email failed", async () => {
    vi.spyOn(adminApi, "listUsers").mockResolvedValue({
      items: [adminUser],
      total: 1,
    });
    vi.spyOn(adminApi, "createUser").mockResolvedValue({
      ...adminUser,
      id: "new-client-id",
      email: "client@example.com",
      role: "client",
      email_verified_at: null,
      firebase_linked: true,
    });
    vi.mocked(firebase.sendPasswordReset).mockRejectedValueOnce(
      new Error("network"),
    );
    renderAdmin(<AdminUserManagementPage />);
    const interaction = userEvent.setup();
    await interaction.click(
      await screen.findByRole("button", { name: "Create account" }),
    );
    await interaction.type(
      screen.getByLabelText("Email address"),
      "client@example.com",
    );
    await interaction.type(
      screen.getByLabelText("Organisation name"),
      "Acme Bank",
    );
    const createButtons = screen.getAllByRole("button", {
      name: "Create account",
    });
    await interaction.click(createButtons[createButtons.length - 1]);
    expect(
      await screen.findByText(/password email could not be sent/),
    ).toBeInTheDocument();
  });

  it("creates a missing Firebase account before sending a password email", async () => {
    // Verified before Firebase existed, but never linked to a Firebase account.
    const legacyClient: AuthUser = {
      ...adminUser,
      id: "legacy-id",
      email: "legacy@example.com",
      role: "client",
      firebase_linked: false,
    };
    vi.spyOn(adminApi, "listUsers").mockResolvedValue({
      items: [adminUser, legacyClient],
      total: 2,
    });
    const prepare = vi
      .spyOn(adminApi, "preparePasswordEmail")
      .mockResolvedValue({ ...legacyClient, firebase_linked: true });
    renderAdmin(<AdminUserManagementPage />);
    const interaction = userEvent.setup();
    const drawer = await openAccount("legacy@example.com");
    await interaction.click(
      within(drawer).getByRole("button", {
        name: "Send password email to legacy@example.com",
      }),
    );
    await waitFor(() =>
      expect(firebase.sendPasswordReset).toHaveBeenCalledWith(
        "legacy@example.com",
      ),
    );
    expect(prepare).toHaveBeenCalledWith("legacy-id");
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(firebase.sendPasswordReset).mock.invocationCallOrder[0],
    );
    expect(
      await screen.findByText("Password email sent to legacy@example.com."),
    ).toBeInTheDocument();
    // A linked, verified account does not need one.
    await interaction.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const admin = await openAccount("admin@example.com");
    expect(
      within(admin).queryByRole("button", {
        name: "Send password email to admin@example.com",
      }),
    ).not.toBeInTheDocument();
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
    const drawer = await openAccount(pendingAgent.email);

    await interaction.click(
      within(drawer).getByRole("combobox", { name: "Role" }),
    );
    await interaction.click(
      await screen.findByRole("option", { name: "Client" }),
    );
    await waitFor(() =>
      expect(setRole).toHaveBeenCalledWith(pendingAgent.id, "client"),
    );

    await interaction.click(
      within(drawer).getByRole("switch", {
        name: `Deactivate ${pendingAgent.email}`,
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Deactivate this account?",
    });
    expect(setActive).not.toHaveBeenCalled();
    await interaction.click(
      within(dialog).getByRole("button", { name: "Deactivate account" }),
    );
    await waitFor(() =>
      expect(setActive).toHaveBeenCalledWith(pendingAgent.id, false),
    );
  });

  it("searches and filters accounts on the server", async () => {
    const list = vi
      .spyOn(adminApi, "listUsers")
      .mockResolvedValue({ items: [pendingAgent], total: 1 });
    renderAdmin(<AdminUserManagementPage />);
    const interaction = userEvent.setup();

    await screen.findByText(pendingAgent.email);
    await interaction.click(screen.getByRole("combobox", { name: "Role" }));
    await interaction.click(screen.getByRole("option", { name: "Agent" }));
    await interaction.click(screen.getByRole("combobox", { name: "Status" }));
    await interaction.click(
      screen.getByRole("option", { name: "Not signed in yet" }),
    );
    await interaction.type(screen.getByLabelText("Search by email"), "pend");
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        offset: 0,
        limit: 25,
        q: "pend",
        role: "agent",
        status: "not_signed_in",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 account match");
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
    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.queryByText("private-ip-hash")).not.toBeInTheDocument();
    expect(screen.queryByText("hidden-password")).not.toBeInTheDocument();
    // Full IDs are in the drawer; the table shows the first block.
    await userEvent.click(
      screen.getByRole("button", { name: "agent approved" }),
    );
    const drawer = await screen.findByRole("dialog", {
      name: "agent approved",
    });
    expect(within(drawer).getByText(adminUser.id)).toBeInTheDocument();
    expect(within(drawer).getByText("request-id")).toBeInTheDocument();
  });

  it("searches and filters events on the server", async () => {
    const list = vi
      .spyOn(adminApi, "listAuditLogs")
      .mockResolvedValue({ items: [], total: 0 });
    renderAdmin(<AdminAuditLogPage />);
    const interaction = userEvent.setup();

    await interaction.click(
      await screen.findByRole("combobox", { name: "Outcome" }),
    );
    await interaction.click(screen.getByRole("option", { name: "Failure" }));
    await interaction.type(
      screen.getByLabelText("Search action, subject, or ID"),
      "login",
    );
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        offset: 0,
        limit: 25,
        q: "login",
        outcome: "failure",
      }),
    );
    expect(
      await screen.findByText("No results match your search or filters"),
    ).toBeInTheDocument();
  });
});

describe("client organisation names", () => {
  const client: AuthUser = {
    ...adminUser,
    id: "client-id",
    email: "client@example.com",
    role: "client",
  };

  it("requires an organisation name for a client but not for an admin", async () => {
    vi.spyOn(adminApi, "listUsers").mockResolvedValue({
      items: [adminUser],
      total: 1,
    });
    vi.spyOn(adminApi, "listClients").mockResolvedValue([]);
    const create = vi
      .spyOn(adminApi, "createUser")
      .mockResolvedValue({ ...adminUser, id: "new-id" });
    renderAdmin(<AdminUserManagementPage />);
    const interaction = userEvent.setup();
    await interaction.click(
      await screen.findByRole("button", { name: "Create account" }),
    );
    await interaction.type(
      screen.getByLabelText("Email address"),
      "new@example.com",
    );
    const submit = () => {
      const buttons = screen.getAllByRole("button", { name: "Create account" });
      return interaction.click(buttons[buttons.length - 1]);
    };
    await submit();
    expect(
      await screen.findByText("Enter the organisation name"),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await interaction.click(screen.getByRole("combobox", { name: "Role" }));
    await interaction.click(screen.getByRole("option", { name: "Admin" }));
    expect(
      screen.queryByLabelText("Organisation name"),
    ).not.toBeInTheDocument();
    await submit();
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        email: "new@example.com",
        role: "admin",
      }),
    );
  });

  it("shows a missing organisation name and lets the admin set it", async () => {
    vi.spyOn(adminApi, "listUsers").mockResolvedValue({
      items: [adminUser, client],
      total: 2,
    });
    vi.spyOn(adminApi, "listClients").mockResolvedValue([
      {
        id: client.id,
        email: client.email,
        is_active: true,
        organisation_name: null,
      },
    ]);
    const save = vi.spyOn(adminApi, "setClientOrganisation").mockResolvedValue({
      id: client.id,
      email: client.email,
      is_active: true,
      organisation_name: "Acme Bank",
    });
    renderAdmin(<AdminUserManagementPage />);
    const interaction = userEvent.setup();

    expect(await screen.findByText("No organisation name")).toBeInTheDocument();
    const drawer = await openAccount(client.email);
    await interaction.click(
      within(drawer).getByRole("button", {
        name: "Set organisation name for client@example.com",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await interaction.type(
      within(dialog).getByLabelText("Organisation name"),
      "  Acme Bank ",
    );
    await interaction.click(
      within(dialog).getByRole("button", { name: "Save" }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("client-id", "Acme Bank"),
    );
    expect(
      await screen.findByText("Organisation name saved."),
    ).toBeInTheDocument();
  });
});
