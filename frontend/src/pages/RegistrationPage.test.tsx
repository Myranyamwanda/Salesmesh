import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as authApi from "../api/auth";
import { RegistrationPage } from "./AuthPages";

vi.mock("../api/auth", () => ({ registerAgent: vi.fn() }));

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
}

async function fillForm(displayName: string) {
  const userInput = userEvent.setup();
  if (displayName) {
    await userInput.type(screen.getByLabelText("Display name"), displayName);
  }
  await userInput.type(
    screen.getByLabelText("Email address"),
    "amina@example.com",
  );
  await userInput.type(screen.getByLabelText("Password"), "Correct-Pass123!");
  await userInput.type(
    screen.getByLabelText("Confirm password"),
    "Correct-Pass123!",
  );
  await userInput.click(
    screen.getByRole("button", { name: "Request agent access" }),
  );
}

describe("agent registration form", () => {
  it("requires a display name", async () => {
    renderPage();
    await fillForm("");
    expect(
      await screen.findByText("Enter the name customers will see"),
    ).toBeInTheDocument();
    expect(authApi.registerAgent).not.toHaveBeenCalled();
  });

  it("sends the trimmed display name", async () => {
    renderPage();
    await fillForm("  Amina Otieno ");
    await waitFor(() =>
      expect(authApi.registerAgent).toHaveBeenCalledWith(
        "amina@example.com",
        "Correct-Pass123!",
        "Amina Otieno",
      ),
    );
    expect(await screen.findByText("Pending")).toBeInTheDocument();
  });
});
