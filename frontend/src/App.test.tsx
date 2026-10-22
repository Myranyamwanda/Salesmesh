import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "./auth/context";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RoleRoute } from "./routes/RoleRoute";
import type { AuthUser, UserRole } from "./types/auth";
import { roleHome } from "./utils/roleHome";

const user: AuthUser = {
  id: "user-id",
  email: "agent@example.com",
  role: "agent",
  status: "approved",
  is_active: true,
  email_verified_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
};

afterEach(cleanup);

function authValue(
  overrides: Partial<React.ContextType<typeof AuthContext>> = {},
) {
  return {
    user: null,
    isLoading: false,
    startSession: vi.fn(async () => user),
    logout: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => undefined),
    clearSession: vi.fn(),
    ...overrides,
  };
}

describe("route guards", () => {
  it("redirects anonymous visitors to login", () => {
    render(
      <AuthContext.Provider value={authValue()}>
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/admin" element={<div>Private page</div>} />
            </Route>
            <Route path="/login" element={<div>Sign in required</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByText("Sign in required")).toBeInTheDocument();
  });

  it("denies the wrong role and permits the correct role", () => {
    const value = authValue({ user: { ...user, role: "agent" } });
    const denied = render(
      <AuthContext.Provider value={value}>
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route element={<RoleRoute allowed={["admin"]} />}>
                <Route path="/admin" element={<div>Admin private page</div>} />
              </Route>
            </Route>
            <Route path="/403" element={<div>Forbidden</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByText("Forbidden")).toBeInTheDocument();
    denied.unmount();

    render(
      <AuthContext.Provider
        value={authValue({ user: { ...user, role: "admin" } })}
      >
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route element={<RoleRoute allowed={["admin"]} />}>
                <Route path="/admin" element={<div>Admin private page</div>} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByText("Admin private page")).toBeInTheDocument();
  });

  it.each(["admin", "agent", "client"] as UserRole[])(
    "maps %s to its own home",
    (role) => {
      expect(roleHome[role]).toBe(`/${role}`);
    },
  );
});
