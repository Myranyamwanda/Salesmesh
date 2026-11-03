import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as scoringApi from "../api/scoring";
import { makeUser, renderPage } from "../test/render";
import type { AssessmentDetail } from "../types/scoring";
import { ReviewDialog } from "./ReviewDialog";

const assessment: AssessmentDetail = {
  id: "assessment-1",
  model_version: "v1",
  probability: 0.0612,
  threshold: 0.035,
  threshold_kind: "standard",
  flagged: true,
  audit_selected: false,
  reasons: [
    {
      source: "model",
      code: "num__missingindicator_session_length_in_minutes",
      text: "Time spent on the form was not measured",
      contribution: 0.23,
    },
  ],
  features: {
    email_is_free: 1,
    keep_alive_session: 1,
    source: "INTERNET",
    phone_mobile_valid: 1,
    date_of_birth_distinct_emails_4w: 0,
    device_os: null,
  },
  feature_effects: {
    email_is_free: "raised",
    keep_alive_session: "lowered",
    source: "no_effect",
    phone_mobile_valid: "unavailable",
    date_of_birth_distinct_emails_4w: "not_used_bank_scale",
    device_os: "withheld_lowered",
  },
  created_at: "2026-10-10T08:00:00Z",
  customer: {
    id: "customer-1",
    reference: "SM-7K3Q-9XPA",
    full_name: "Wanjiru Kamau",
    email: "wanjiru@gmail.com",
    mobile_phone: "0712345678",
    secondary_phone: null,
    date_of_birth: "1995-05-17",
    country: "KE",
    current_address_months: 24,
    previous_address_months: null,
    assisted: true,
    status: "pending_review",
    created_at: "2026-10-10T08:00:00Z",
  },
  registration_status: "under_review",
  agent: { id: "agent-1", display_name: "Amina Otieno" },
  review: null,
};

afterEach(cleanup);

function effectOf(name: string) {
  const row = screen.getByRole("row", { name: new RegExp(`^${name}`) });
  return within(row).getAllByRole("cell")[2].textContent;
}

async function openDialog() {
  vi.spyOn(scoringApi, "getAssessment").mockResolvedValue(assessment);
  renderPage(<ReviewDialog assessmentId="assessment-1" onClose={() => {}} />, {
    user: makeUser("admin"),
  });
  await screen.findByRole("table", { name: "Feature values" });
}

describe("ReviewDialog explanation", () => {
  it("shows the model version and threshold stored at scoring", async () => {
    await openDialog();

    const version = screen.getByText("Model version");
    expect(version.parentElement).toHaveTextContent("v1");
    const threshold = screen.getByText("Threshold at scoring");
    expect(threshold.parentElement).toHaveTextContent("3.5%");
  });

  it("explains what the probability means", async () => {
    await openDialog();

    expect(screen.getByText(/It is not proof/)).toHaveTextContent(
      /about 9 in\s+10 registrations flagged/,
    );
  });

  it("gives every feature a text effect", async () => {
    await openDialog();

    expect(effectOf("Free email provider")).toBe("Raised the score");
    expect(effectOf("Kept signed in")).toBe("Lowered the score");
    expect(effectOf("Source")).toBe("No real effect");
    expect(effectOf("Valid mobile phone")).toBe(
      "Not available (the model that scored this is not loaded)",
    );
  });

  it("labels the features the model did not use", async () => {
    await openDialog();

    expect(effectOf("Emails with same date of birth")).toBe(
      "Not used by the model (bank-scale feature)",
    );
    expect(effectOf("Device operating system")).toBe(
      "Lowered the score (withheld on an assisted registration, scored as missing)",
    );
  });

  it("marks the form-time reason as expected on an assisted registration", async () => {
    await openDialog();

    expect(
      screen.getByText(/Time spent on the form was not measured/),
    ).toHaveTextContent("(expected: registered on the agent's device)");
  });

  it("shows the assisted threshold and explains a random audit", async () => {
    vi.spyOn(scoringApi, "getAssessment").mockResolvedValue({
      ...assessment,
      threshold: 0.008039,
      threshold_kind: "assisted",
      flagged: false,
      audit_selected: true,
      reasons: [
        {
          source: "audit",
          code: "audit__assisted",
          text: "Random audit (assisted registration)",
        },
      ],
    });
    renderPage(
      <ReviewDialog assessmentId="assessment-1" onClose={() => {}} />,
      {
        user: makeUser("admin"),
      },
    );

    const threshold = await screen.findByText("Threshold at scoring");
    expect(threshold.parentElement).toHaveTextContent(
      "0.80% (assisted registration)",
    );
    expect(
      screen.getByText(/Random audit: this assisted registration/),
    ).toHaveTextContent(
      "does not count as a flag unless you confirm it as fake",
    );
    expect(screen.getByRole("listitem")).toHaveTextContent(
      "AuditRandom audit (assisted registration)",
    );
  });
});
