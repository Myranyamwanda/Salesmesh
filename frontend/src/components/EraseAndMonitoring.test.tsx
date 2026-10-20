import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as scoringApi from "../api/scoring";
import { makeUser, renderPage } from "../test/render";
import type { AssessmentDetail, CustomerStatus } from "../types/scoring";
import { MonitoringCard } from "./MonitoringCard";
import { ReviewDialog } from "./ReviewDialog";

const admin = makeUser("admin");
const REJECTED = /This customer was confirmed fake/;
const PENDING = /This customer is flagged and awaiting review/;

afterEach(cleanup);

function assessment(status: CustomerStatus): AssessmentDetail {
  return {
    id: "assessment-1",
    model_version: "v1",
    probability: 0.06,
    threshold: 0.035,
    flagged: status !== "verified",
    reasons: [],
    features: {},
    created_at: "2026-10-10T08:00:00Z",
    customer: {
      id: "customer-1",
      full_name: "Wanjiru Kamau",
      email: "wanjiru@gmail.com",
      mobile_phone: "0712345678",
      secondary_phone: null,
      date_of_birth: "1995-05-17",
      country: "KE",
      current_address_months: 24,
      previous_address_months: null,
      assisted: false,
      status,
      created_at: "2026-10-10T08:00:00Z",
    },
    agent: { id: "agent-1", display_name: "Amina Otieno" },
    review: null,
  };
}

async function openErase(status: CustomerStatus) {
  vi.spyOn(scoringApi, "getAssessment").mockResolvedValue(assessment(status));
  const input = userEvent.setup();
  renderPage(<ReviewDialog assessmentId="assessment-1" onClose={() => {}} />, {
    user: admin,
  });
  await input.click(
    await screen.findByRole("button", { name: "Erase customer data" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Erase customer data",
  });
  return { input, dialog };
}

describe("erase customer data", () => {
  it("warns that erasing a confirmed fake removes fraud evidence", async () => {
    const { dialog } = await openErase("rejected");
    expect(within(dialog).getByText(REJECTED)).toBeInTheDocument();
    expect(within(dialog).queryByText(PENDING)).not.toBeInTheDocument();
  });

  it("suggests finishing the review of a pending customer first", async () => {
    const { dialog } = await openErase("pending_review");
    expect(within(dialog).getByText(PENDING)).toBeInTheDocument();
    expect(within(dialog).queryByText(REJECTED)).not.toBeInTheDocument();
  });

  it("shows no warning for a verified customer", async () => {
    const { dialog } = await openErase("verified");
    expect(within(dialog).queryByText(REJECTED)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(PENDING)).not.toBeInTheDocument();
  });

  it("erases only after the customer's email is typed", async () => {
    const erase = vi
      .spyOn(scoringApi, "eraseCustomer")
      .mockResolvedValue(undefined);
    const { input, dialog } = await openErase("rejected");
    const button = within(dialog).getByRole("button", { name: "Erase" });
    expect(button).toBeDisabled();

    const field = within(dialog).getByLabelText(
      "Type the customer's email to confirm",
    );
    await input.type(field, "someone@else.com");
    expect(button).toBeDisabled();
    await input.clear(field);
    await input.type(field, "WANJIRU@gmail.com");
    expect(button).toBeEnabled();

    // The warning informs but does not block the erasure.
    await input.click(button);
    await waitFor(() =>
      expect(erase).toHaveBeenCalledWith("customer-1", "WANJIRU@gmail.com"),
    );
  });
});

describe("model monitoring card", () => {
  it("compares the monthly flag rate with p0", async () => {
    vi.spyOn(scoringApi, "getMonitoring").mockResolvedValue({
      p0: 0.0539,
      months: [
        {
          month: "2026-09",
          assessments: 0,
          flag_rate: null,
          mean_probability: null,
        },
        {
          month: "2026-10",
          assessments: 3,
          flag_rate: 0.6667,
          mean_probability: 0.05,
        },
      ],
    });
    renderPage(<MonitoringCard />, { user: admin });

    expect(
      await screen.findByText(/Expected flag rate \(p0\): 5\.39%/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A sustained difference from p0 can indicate drift/),
    ).toBeInTheDocument();
    const october = screen.getByRole("row", { name: /2026-10/ });
    expect(
      within(october)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["2026-10", "3", "66.67%", "5.00%"]);
    const september = screen.getByRole("row", { name: /2026-09/ });
    expect(within(september).getAllByText("—")).toHaveLength(2);
  });
});
