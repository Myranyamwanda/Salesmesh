import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthContextValue } from "../auth/context";
import type { AuthUser, UserRole } from "../types/auth";

export function makeUser(role: UserRole, overrides: Partial<AuthUser> = {}) {
  return {
    id: `${role}-id`,
    email: `${role}@example.com`,
    role,
    status: "approved",
    is_active: true,
    email_verified_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } satisfies AuthUser;
}

/**
 * Render a page inside the app's providers: a fresh query cache (no retries,
 * so failed requests show their error at once), an auth context, and a router.
 */
export function renderPage(
  page: ReactNode,
  {
    path = "/",
    route = path,
    user = null,
  }: { path?: string; route?: string; user?: AuthUser | null } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const auth: AuthContextValue = {
    user,
    isLoading: false,
    startSession: async () => user as AuthUser,
    legacyLogin: async () => user as AuthUser,
    logout: async () => undefined,
    logoutAll: async () => undefined,
    clearSession: () => undefined,
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={page} />
            <Route path="*" element={<div>Other page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

/** An axios-like error with an HTTP status, as the API helpers would throw. */
export function httpError(
  status: number,
  message = "Request failed",
  code = `http_${status}`,
) {
  return Object.assign(new Error(message), {
    isAxiosError: true,
    response: { status, data: { error: { code, message } } },
  });
}
