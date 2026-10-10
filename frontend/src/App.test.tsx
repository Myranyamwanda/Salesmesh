import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthContext } from "./auth/context";
import { LoginPage } from "./pages/AuthPages";
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

function LocationText() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderWithAuth(
  page: React.ReactNode,
  value: React.ContextType<typeof AuthContext>,
  initialEntry = "/login",
) {
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={page} />
          <Route path="/admin" element={<div>Admin home</div>} />
          <Route path="/agent" element={<div>Agent home</div>} />
          <Route path="/client" element={<div>Client home</div>} />
          <Route path="/403" element={<div>Forbidden</div>} />
        </Routes>
        <LocationText />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function authValue(
  overrides: Partial<React.ContextType<typeof AuthContext>> = {},
) {
  return {
    user: null,
    isLoading: false,
    login: vi.fn(async () => user),
    logout: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => undefined),
    clearSession: vi.fn(),
    ...overrides,
  };
}

describe("login form", () => {
  it("shows validation errors and does not submit invalid credentials", async () => {
    const value = authValue();
    const userInput = userEvent.setup();
    renderWithAuth(<LoginPage />, value);
    await userInput.type(
      screen.getByLabelText("Email address"),
      "not-an-email",
    );
    await userInput.type(screen.getByLabelText("Password"), "password");
    await userInput.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Enter a valid email address"),
    ).toBeInTheDocument();
    expect(value.login).not.toHaveBeenCalled();
  });

  it("submits valid credentials and redirects by role", async () => {
    const value = authValue();
    const userInput = userEvent.setup();
    renderWithAuth(<LoginPage />, value);
    await userInput.type(screen.getByLabelText("Email address"), user.email);
    await userInput.type(
      screen.getByLabelText("Password"),
      "Correct-Passphrase123!",
    );
    await userInput.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/agent"),
    );
    expect(value.login).toHaveBeenCalledWith(
      user.email,
      "Correct-Passphrase123!",
    );
  });

  it("keeps submit disabled while login is pending", async () => {
    let complete!: (value: AuthUser) => void;
    const value = authValue({
      login: vi.fn(
        () =>
          new Promise<AuthUser>((resolve) => {
            complete = resolve;
          }),
      ),
    });
    const userInput = userEvent.setup();
    renderWithAuth(<LoginPage />, value);
    await userInput.type(screen.getByLabelText("Email address"), user.email);
    await userInput.type(
      screen.getByLabelText("Password"),
      "Correct-Passphrase123!",
    );
    await userInput.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    complete(user);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/agent"),
    );
  });
});

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
