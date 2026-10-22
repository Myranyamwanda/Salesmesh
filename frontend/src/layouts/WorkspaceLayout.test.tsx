import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthContextValue } from "../auth/context";
import { makeUser } from "../test/render";
import type { UserRole } from "../types/auth";
import { roleHome } from "../utils/roleHome";
import { WorkspaceLayout } from "./WorkspaceLayout";

afterEach(cleanup);

function renderLayout(role: UserRole) {
  const user = makeUser(role);
  const auth: AuthContextValue = {
    user,
    isLoading: false,
    startSession: async () => user,
    logout: async () => undefined,
    logoutAll: async () => undefined,
    clearSession: () => undefined,
  };
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[roleHome[role]]}>
        <Routes>
          <Route element={<WorkspaceLayout role={role} />}>
            <Route path={roleHome[role]} element={<div>Page content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function workspaceLinks() {
  // The sidebar is rendered twice (mobile and desktop drawers); use the first.
  const sidebar = document.querySelector<HTMLElement>(
    ".workspace-side-content",
  );
  if (!sidebar) throw new Error("Sidebar not rendered");
  return within(sidebar)
    .getAllByRole("link")
    .map((link) => link.textContent);
}

describe("workspace navigation", () => {
  it("shows every admin page", () => {
    renderLayout("admin");
    expect(workspaceLinks()).toEqual(
      expect.arrayContaining([
        "Overview",
        "Agents",
        "Review queue",
        "Model",
        "User management",
        "Audit log",
        "Settings",
        "My profile",
      ]),
    );
  });

  it("gives agents only their referral link and customers", () => {
    renderLayout("agent");
    const links = workspaceLinks();
    expect(links).toEqual(
      expect.arrayContaining(["Referral link", "My customers"]),
    );
    expect(links.join(" ")).not.toMatch(/reputation|dashboard|tasks|review/i);
  });

  it("gives clients the registration quality page", () => {
    renderLayout("client");
    const links = workspaceLinks();
    expect(links).toContain("Registration quality");
    expect(links.join(" ")).not.toMatch(/reports|agents|review/i);
  });
});
