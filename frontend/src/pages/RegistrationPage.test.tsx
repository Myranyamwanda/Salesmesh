import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as authApi from "../api/auth";
import * as firebase from "../auth/firebase";
import { httpError } from "../test/render";
import { RegistrationPage } from "./AuthPages";

vi.mock("../api/auth", () => ({ registerAgent: vi.fn() }));
vi.mock("../auth/firebase", () => ({
  currentFirebaseUser: vi.fn(() => null),
  signUpWithPassword: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOutOfFirebase: vi.fn(async () => undefined),
  refreshVerification: vi.fn(),
  resendVerification: vi.fn(),
  idToken: vi.fn(async () => "firebase-id-token"),
  firebaseErrorCode: () => "",
  firebaseErrorMessage: () => null,
  wasCancelled: () => false,
}));

const PASSWORD = "Correct-Pass123!";

function firebaseUser(emailVerified: boolean) {
  return { email: "amina@example.com", emailVerified } as firebase.FirebaseUser;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/register"]}>
      <Routes>
        <Route path="/register" element={<RegistrationPage />} />
        <Route path="/registration-pending" element={<div>Pending</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

async function createAccount(
  interaction: ReturnType<typeof userEvent.setup>,
  password = PASSWORD,
) {
  await interaction.type(
    screen.getByLabelText("Email address"),
    "amina@example.com",
  );
  await interaction.type(screen.getByLabelText("Password"), password);
  await interaction.type(screen.getByLabelText("Confirm password"), password);
  await interaction.click(
    screen.getByRole("button", { name: "Create account" }),
  );
}

describe("agent registration", () => {
  it("enforces the 12-character password rule before calling Firebase", async () => {
    const interaction = renderPage();
    await createAccount(interaction, "Short-pass1");
    expect(
      await screen.findByText("Use at least 12 characters"),
    ).toBeInTheDocument();
    expect(firebase.signUpWithPassword).not.toHaveBeenCalled();
  });

  it("verifies the email, then sends the trimmed display name", async () => {
    const user = firebaseUser(false);
    vi.mocked(firebase.signUpWithPassword).mockResolvedValue(user);
    vi.mocked(firebase.refreshVerification).mockResolvedValue(true);
    vi.mocked(authApi.registerAgent).mockResolvedValue({} as never);
    const interaction = renderPage();
    await createAccount(interaction);
    expect(firebase.signUpWithPassword).toHaveBeenCalledWith(
      "amina@example.com",
      PASSWORD,
    );
    expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
    await interaction.click(
      screen.getByRole("button", { name: "I have verified my email" }),
    );
    await interaction.click(
      await screen.findByRole("button", { name: "Request agent access" }),
    );
    expect(
      await screen.findByText("Enter the name customers will see"),
    ).toBeInTheDocument();
    expect(authApi.registerAgent).not.toHaveBeenCalled();
    await interaction.type(
      screen.getByLabelText("Display name"),
      "  Amina Otieno ",
    );
    await interaction.click(
      screen.getByRole("button", { name: "Request agent access" }),
    );
    await waitFor(() =>
      expect(authApi.registerAgent).toHaveBeenCalledWith(
        "firebase-id-token",
        "Amina Otieno",
      ),
    );
    expect(await screen.findByText("Pending")).toBeInTheDocument();
  });

  it("goes straight to the display name after Google sign-up", async () => {
    vi.mocked(firebase.signInWithGoogle).mockResolvedValue(firebaseUser(true));
    const interaction = renderPage();
    await interaction.click(
      screen.getByRole("button", { name: "Sign up with Google" }),
    );
    expect(await screen.findByLabelText("Display name")).toBeInTheDocument();
  });

  it("explains a rejected disposable or mail-less address", async () => {
    vi.mocked(firebase.currentFirebaseUser).mockReturnValue(firebaseUser(true));
    vi.mocked(authApi.registerAgent).mockRejectedValue(
      httpError(422, "Use a permanent email address", "email_not_permanent"),
    );
    const interaction = renderPage();
    await interaction.type(screen.getByLabelText("Display name"), "Amina");
    await interaction.click(
      screen.getByRole("button", { name: "Request agent access" }),
    );
    expect(
      await screen.findByText("Use a permanent email address"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Disposable or mail-less addresses cannot be used/),
    ).toBeInTheDocument();
  });
});
