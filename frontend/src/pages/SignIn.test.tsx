import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import * as authApi from "../api/auth";
import { AuthContext, type AuthContextValue } from "../auth/context";
import * as firebase from "../auth/firebase";
import { httpError, makeUser } from "../test/render";
import type { AuthUser } from "../types/auth";
import {
  ChangePasswordPage,
  ForgotPasswordPage,
  LegacyLoginPage,
  LoginPage,
} from "./AuthPages";

vi.mock("../auth/firebase", () => ({
  signInWithPassword: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOutOfFirebase: vi.fn(async () => undefined),
  idToken: vi.fn(async () => "firebase-id-token"),
  refreshVerification: vi.fn(),
  resendVerification: vi.fn(),
  sendPasswordReset: vi.fn(async () => undefined),
  changePassword: vi.fn(async () => undefined),
  currentFirebaseUser: vi.fn(() => null),
  signUpWithPassword: vi.fn(),
  firebaseErrorCode: (error: { code?: string }) => error?.code ?? "",
  firebaseErrorMessage: (error: { code?: string }) =>
    error?.code?.startsWith("auth/") ? `Firebase says ${error.code}` : null,
  wasCancelled: (error: { code?: string }) =>
    error?.code === "auth/popup-closed-by-user",
}));
vi.mock("../api/auth", () => ({
  exchangeFirebaseToken: vi.fn(),
  verifyMfa: vi.fn(),
  startMfaSetup: vi.fn(),
  confirmMfaSetup: vi.fn(),
}));

const PASSWORD = "Correct-Passphrase123!";

function firebaseUser(email = "agent@example.com", emailVerified = true) {
  return { email, emailVerified } as firebase.FirebaseUser;
}

function LocationText() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderSignIn(
  page: React.ReactNode,
  overrides: Partial<AuthContextValue> = {},
  user: AuthUser | null = null,
) {
  const auth: AuthContextValue = {
    user,
    isLoading: false,
    startSession: vi.fn(async () => makeUser("agent")),
    legacyLogin: vi.fn(async () => makeUser("admin")),
    logout: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => undefined),
    clearSession: vi.fn(),
    ...overrides,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={["/start"]}>
          <Routes>
            <Route path="/start" element={page} />
            <Route path="*" element={<div>Other page</div>} />
          </Routes>
          <LocationText />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { auth, interaction: userEvent.setup() };
}

async function submitCredentials(
  interaction: ReturnType<typeof userEvent.setup>,
) {
  await interaction.type(
    screen.getByLabelText("Email address"),
    "a@example.com",
  );
  await interaction.type(screen.getByLabelText("Password"), PASSWORD);
  await interaction.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  vi.mocked(firebase.signInWithPassword).mockResolvedValue(firebaseUser());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Firebase sign-in", () => {
  it("validates the form before calling Firebase", async () => {
    const { interaction } = renderSignIn(<LoginPage />);
    await interaction.type(screen.getByLabelText("Email address"), "nope");
    await interaction.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Enter a valid email address"),
    ).toBeInTheDocument();
    expect(firebase.signInWithPassword).not.toHaveBeenCalled();
  });

  it("exchanges the ID token and opens the role's home", async () => {
    vi.mocked(authApi.exchangeFirebaseToken).mockResolvedValue({
      access_token: "salesmesh-token",
      token_type: "bearer",
      expires_in: 900,
    });
    const { auth, interaction } = renderSignIn(<LoginPage />);
    await submitCredentials(interaction);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/agent"),
    );
    expect(firebase.signInWithPassword).toHaveBeenCalledWith(
      "a@example.com",
      PASSWORD,
    );
    expect(authApi.exchangeFirebaseToken).toHaveBeenCalledWith(
      "firebase-id-token",
    );
    expect(auth.startSession).toHaveBeenCalledWith("salesmesh-token");
    // SalesMesh holds the session; Firebase's own sign-in is dropped.
    expect(firebase.signOutOfFirebase).toHaveBeenCalled();
  });

  it("keeps the button disabled while signing in", async () => {
    let finish!: (user: firebase.FirebaseUser) => void;
    vi.mocked(firebase.signInWithPassword).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    vi.mocked(authApi.exchangeFirebaseToken).mockResolvedValue({
      access_token: "t",
      token_type: "bearer",
      expires_in: 900,
    });
    const { interaction } = renderSignIn(<LoginPage />);
    await submitCredentials(interaction);
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    finish(firebaseUser());
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/agent"),
    );
  });

  it("signs in with Google and ignores a closed Google window", async () => {
    vi.mocked(firebase.signInWithGoogle).mockRejectedValueOnce({
      code: "auth/popup-closed-by-user",
    });
    const { interaction } = renderSignIn(<LoginPage />);
    await interaction.click(
      screen.getByRole("button", { name: "Sign in with Google" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows Firebase's error for a wrong password", async () => {
    vi.mocked(firebase.signInWithPassword).mockRejectedValue({
      code: "auth/invalid-credential",
    });
    const { interaction } = renderSignIn(<LoginPage />);
    await submitCredentials(interaction);
    expect(
      await screen.findByText("Firebase says auth/invalid-credential"),
    ).toBeInTheDocument();
    expect(authApi.exchangeFirebaseToken).not.toHaveBeenCalled();
  });

  it("asks an unverified user to verify the email first", async () => {
    vi.mocked(firebase.signInWithPassword).mockResolvedValue(
      firebaseUser("new@example.com", false),
    );
    const { interaction } = renderSignIn(<LoginPage />);
    await submitCredentials(interaction);
    expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
    expect(authApi.exchangeFirebaseToken).not.toHaveBeenCalled();
  });

  it("sends a pending agent to the waiting page", async () => {
    vi.mocked(authApi.exchangeFirebaseToken).mockRejectedValue(
      httpError(403, "Awaiting approval", "account_pending"),
    );
    const { interaction } = renderSignIn(<LoginPage />);
    await submitCredentials(interaction);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/registration-pending",
      ),
    );
  });

  it("offers agent registration when there is no SalesMesh account", async () => {
    vi.mocked(authApi.exchangeFirebaseToken).mockRejectedValue(
      httpError(404, "No account", "account_not_found"),
    );
    const { interaction } = renderSignIn(<LoginPage />);
    await submitCredentials(interaction);
    expect(
      await screen.findByText("This email has no SalesMesh account"),
    ).toBeInTheDocument();
    await interaction.click(
      screen.getByRole("button", { name: "Request agent access" }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/register");
  });

  it("shows the API's message for an inactive account", async () => {
    vi.mocked(authApi.exchangeFirebaseToken).mockRejectedValue(
      httpError(403, "This account cannot sign in.", "account_inactive"),
    );
    const { interaction } = renderSignIn(<LoginPage />);
    await submitCredentials(interaction);
    expect(
      await screen.findByText("This account cannot sign in."),
    ).toBeInTheDocument();
  });
});

describe("admin two-step sign-in", () => {
  it("requires an authenticator code before signing an admin in", async () => {
    vi.mocked(authApi.exchangeFirebaseToken).mockResolvedValue({
      mfa: "verify",
      mfa_token: "mfa-token",
      expires_in: 300,
    });
    vi.mocked(authApi.verifyMfa)
      .mockRejectedValueOnce(httpError(401, "That code is not correct"))
      .mockResolvedValueOnce({
        access_token: "admin-token",
        token_type: "bearer",
        expires_in: 900,
      });
    const { auth, interaction } = renderSignIn(<LoginPage />, {
      startSession: vi.fn(async () => makeUser("admin")),
    });
    await submitCredentials(interaction);
    expect(await screen.findByText("Enter your code")).toBeInTheDocument();
    expect(auth.startSession).not.toHaveBeenCalled();
    const field = screen.getByLabelText("Authenticator or recovery code");
    await interaction.type(field, "000000");
    await interaction.click(screen.getByRole("button", { name: "Verify" }));
    expect(
      await screen.findByText("That code is not correct"),
    ).toBeInTheDocument();
    await interaction.type(field, "123456");
    await interaction.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/admin"),
    );
    expect(authApi.verifyMfa).toHaveBeenLastCalledWith("mfa-token", "123456");
    expect(auth.startSession).toHaveBeenCalledWith("admin-token");
  });

  it("sends the admin back to sign in when the MFA step expires", async () => {
    vi.mocked(authApi.exchangeFirebaseToken).mockResolvedValue({
      mfa: "verify",
      mfa_token: "old-token",
      expires_in: 300,
    });
    vi.mocked(authApi.verifyMfa).mockRejectedValue(
      httpError(401, "Expired", "mfa_session_expired"),
    );
    const { interaction } = renderSignIn(<LoginPage />);
    await submitCredentials(interaction);
    await interaction.type(
      await screen.findByLabelText("Authenticator or recovery code"),
      "123456",
    );
    await interaction.click(screen.getByRole("button", { name: "Verify" }));
    expect(
      await screen.findByText("Your sign-in took too long. Sign in again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("sets up the authenticator and shows recovery codes once", async () => {
    vi.mocked(authApi.exchangeFirebaseToken).mockResolvedValue({
      mfa: "setup",
      mfa_token: "mfa-token",
      expires_in: 300,
    });
    vi.mocked(authApi.startMfaSetup).mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXP",
      otpauth_uri:
        "otpauth://totp/SalesMesh:admin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=SalesMesh",
    });
    vi.mocked(authApi.confirmMfaSetup).mockResolvedValue({
      access_token: "admin-token",
      token_type: "bearer",
      expires_in: 900,
      recovery_codes: ["ABCD-EFGH-JKMN", "PQRS-TUVW-XYZ2"],
    });
    const { auth, interaction } = renderSignIn(<LoginPage />, {
      startSession: vi.fn(async () => makeUser("admin")),
    });
    await submitCredentials(interaction);
    expect(
      await screen.findByText("Set up your authenticator"),
    ).toBeInTheDocument();
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(
      screen.getByTitle("QR code for your authenticator app"),
    ).toBeInTheDocument();
    expect(authApi.startMfaSetup).toHaveBeenCalledTimes(1);
    await interaction.type(screen.getByLabelText("6-digit code"), "123456");
    await interaction.click(
      screen.getByRole("button", { name: "Turn on two-step sign-in" }),
    );
    expect(await screen.findByText("ABCD-EFGH-JKMN")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Continue" });
    // Not signed in until the admin confirms the codes are saved.
    expect(next).toBeDisabled();
    expect(auth.startSession).not.toHaveBeenCalled();
    await interaction.click(screen.getByLabelText("I have saved these codes"));
    await interaction.click(next);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/admin"),
    );
    expect(auth.startSession).toHaveBeenCalledWith("admin-token");
  });
});

describe("other account pages", () => {
  it("keeps the legacy password sign-in as a fallback", async () => {
    const { auth, interaction } = renderSignIn(<LegacyLoginPage />);
    await submitCredentials(interaction);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/admin"),
    );
    expect(auth.legacyLogin).toHaveBeenCalledWith("a@example.com", PASSWORD);
    expect(firebase.signInWithPassword).not.toHaveBeenCalled();
  });

  it("sends Firebase's reset email without revealing unknown accounts", async () => {
    vi.mocked(firebase.sendPasswordReset).mockRejectedValueOnce({
      code: "auth/user-not-found",
    });
    const { interaction } = renderSignIn(<ForgotPasswordPage />);
    await interaction.type(
      screen.getByLabelText("Email address"),
      "who@example.com",
    );
    await interaction.click(
      screen.getByRole("button", { name: "Send reset link" }),
    );
    expect(
      await screen.findByText(/If an account uses this email/),
    ).toBeInTheDocument();
    expect(firebase.sendPasswordReset).toHaveBeenCalledWith("who@example.com");
  });

  it("enforces the 12-character rule when changing a password", async () => {
    const user = makeUser("client");
    const { auth, interaction } = renderSignIn(
      <ChangePasswordPage />,
      {},
      user,
    );
    await interaction.type(screen.getByLabelText("Current password"), "Old");
    await interaction.type(screen.getByLabelText("New password"), "Short1!");
    await interaction.type(
      screen.getByLabelText("Confirm new password"),
      "Short1!",
    );
    await interaction.click(
      screen.getByRole("button", { name: "Change password" }),
    );
    expect(
      await screen.findByText("Use at least 12 characters"),
    ).toBeInTheDocument();
    expect(firebase.changePassword).not.toHaveBeenCalled();

    const newPassword = screen.getByLabelText("New password");
    const confirm = screen.getByLabelText("Confirm new password");
    await interaction.clear(newPassword);
    await interaction.type(newPassword, PASSWORD);
    await interaction.clear(confirm);
    await interaction.type(confirm, PASSWORD);
    await interaction.click(
      screen.getByRole("button", { name: "Change password" }),
    );
    await waitFor(() =>
      expect(firebase.changePassword).toHaveBeenCalledWith(
        user.email,
        "Old",
        PASSWORD,
      ),
    );
    expect(auth.logoutAll).toHaveBeenCalled();
  });
});
