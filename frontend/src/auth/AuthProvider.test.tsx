import axios from "axios";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "../hooks/useAuth";
import { getAccessToken, setAccessToken } from "../api/client";
import type { AuthUser } from "../types/auth";

const currentUser: AuthUser = {
  id: "user-id",
  email: "admin@example.com",
  role: "admin",
  status: "approved",
  is_active: true,
  email_verified_at: "2026-01-01T00:00:00Z",
  firebase_linked: true,
  created_at: "2026-01-01T00:00:00Z",
};

function AuthStatus() {
  const { user, isLoading } = useAuth();
  return (
    <output>{isLoading ? "restoring" : (user?.email ?? "anonymous")}</output>
  );
}

afterEach(() => {
  setAccessToken(null);
  vi.restoreAllMocks();
});

describe("AuthProvider", () => {
  it("restores the session from the refresh cookie into memory", async () => {
    vi.spyOn(axios, "post").mockResolvedValue({
      data: { access_token: "restored-access-token" },
    } as never);
    const getMe = await import("../api/auth").then((module) =>
      vi.spyOn(module, "getMe").mockResolvedValue(currentUser),
    );

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(currentUser.email)).toBeInTheDocument(),
    );
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe("restored-access-token");
  });
});
