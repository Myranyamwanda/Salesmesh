import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as portalApi from "../api/portal";
import { httpError, makeUser, renderPage } from "../test/render";
import { JoinPage } from "./JoinPage";

const CODE = "AGT-7K3Q9XMD";

function renderJoin(user = null as ReturnType<typeof makeUser> | null) {
  return renderPage(<JoinPage />, {
    path: "/join/:code",
    route: `/join/${CODE}`,
    user,
  });
}

async function fillAboutFields() {
  const input = userEvent.setup();
  await input.type(await screen.findByLabelText("Full name"), "Wanjiru Kamau");
  await input.type(screen.getByLabelText("Email address"), "wanjiru@gmail.com");
  await input.type(screen.getByLabelText("Mobile number"), "0712345678");
  await input.type(screen.getByLabelText("Date of birth"), "1995-05-17");
  return input;
}

async function fillRequiredFields() {
  const input = await fillAboutFields();
  await input.click(await screen.findByRole("button", { name: "Continue" }));
  const currentAddress = screen.getByRole("group", {
    name: "Time at your current address",
  });
  await input.selectOptions(
    within(currentAddress).getByLabelText("Years"),
    "2",
  );
  await input.selectOptions(
    within(currentAddress).getByLabelText("Months"),
    "0",
  );
  await input.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Review and consent" });
  return input;
}

beforeEach(() => {
  vi.spyOn(portalApi, "getJoinLink").mockResolvedValue({
    display_name: "Amina Otieno",
    client_name: "Acme Bank",
  });
  vi.spyOn(portalApi, "registerCustomer").mockResolvedValue({
    message: "Registration received",
    reference: "SM-7K3Q-9XPA",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("public join page", () => {
  it("names the client and the agent", async () => {
    renderJoin();
    expect(await screen.findByText("Registration for")).toBeInTheDocument();
    expect(screen.getByText("Acme Bank")).toBeInTheDocument();
    expect(
      screen.getByText("Amina Otieno", { exact: true }),
    ).toBeInTheDocument();
    expect(portalApi.getJoinLink).toHaveBeenCalledWith(CODE);
  });

  it("says in the consent text that details are shared with the client", async () => {
    renderJoin();
    await fillRequiredFields();
    expect(
      await screen.findByLabelText(
        /share my details with Acme Bank for onboarding/,
      ),
    ).toBeInTheDocument();
  });

  it("shows a friendly page for an inactive link", async () => {
    vi.mocked(portalApi.getJoinLink).mockRejectedValue(
      httpError(404, "This link is not active"),
    );
    renderJoin();
    expect(
      await screen.findByRole("heading", { name: "This link is not active" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Contact your agent.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });

  it("requires consent before registering", async () => {
    renderJoin();
    const input = await fillRequiredFields();
    await input.click(screen.getByRole("button", { name: "Register" }));
    expect(
      await screen.findByText("Please agree before registering"),
    ).toBeInTheDocument();
    expect(portalApi.registerCustomer).not.toHaveBeenCalled();
  });

  it("suggests a common email-domain correction without changing it automatically", async () => {
    renderJoin();
    const input = userEvent.setup();
    await input.type(
      await screen.findByLabelText("Email address"),
      "a@gmial.com",
    );
    const suggestion = await screen.findByRole("button", {
      name: "Use a@gmail.com",
    });
    expect(screen.getByLabelText("Email address")).toHaveValue("a@gmial.com");
    await input.click(suggestion);
    expect(screen.getByLabelText("Email address")).toHaveValue("a@gmail.com");
  });

  it("opens the privacy notice from the consent block", async () => {
    renderJoin();
    const input = userEvent.setup();
    await input.click(
      await screen.findByRole("button", { name: "How we use your data" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "How we use your data",
    });
    expect(dialog).toHaveTextContent(
      "register your account and to prevent fraud",
    );
    expect(dialog).toHaveTextContent(
      "Your details are shared with Acme Bank, the organisation you are registering for",
    );
    expect(dialog).toHaveTextContent("sees only your name");
    expect(dialog).toHaveTextContent("privacy@example.com");
  });

  it("keeps form data in memory when moving backward between steps", async () => {
    renderJoin();
    const input = await fillAboutFields();
    await input.click(await screen.findByRole("button", { name: "Continue" }));
    const currentAddress = screen.getByRole("group", {
      name: "Time at your current address",
    });
    await input.selectOptions(
      within(currentAddress).getByLabelText("Years"),
      "1",
    );
    await input.selectOptions(
      within(currentAddress).getByLabelText("Months"),
      "2",
    );
    await input.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Review and consent" });
    await input.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "Where you live" });
    expect(
      within(
        screen.getByRole("group", {
          name: "Time at your current address",
        }),
      ).getByLabelText("Years"),
    ).toHaveValue("1");
    expect(
      within(
        screen.getByRole("group", {
          name: "Time at your current address",
        }),
      ).getByLabelText("Months"),
    ).toHaveValue("2");
    await input.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "About you" });
    expect(screen.getByLabelText("Full name")).toHaveValue("Wanjiru Kamau");
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "wanjiru@gmail.com",
    );
    expect(screen.getByLabelText("Mobile number")).toHaveValue("0712345678");
  });

  it("sends the form with device, session, and browser details", async () => {
    renderJoin();
    const input = await fillRequiredFields();
    await input.click(screen.getByRole("checkbox", { name: /I agree/ }));
    await input.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => expect(portalApi.registerCustomer).toHaveBeenCalled());
    const [code, payload] = vi.mocked(portalApi.registerCustomer).mock.calls[0];
    expect(code).toBe(CODE);
    expect(payload).toMatchObject({
      full_name: "Wanjiru Kamau",
      email: "wanjiru@gmail.com",
      mobile_phone: "+254712345678",
      secondary_phone: null,
      date_of_birth: "1995-05-17",
      country: "KE",
      current_address_months: 24,
      previous_address_months: null,
      consent: true,
      user_agent: navigator.userAgent,
      assisted: false,
    });
    expect(payload.session_length_minutes).toBeGreaterThanOrEqual(0);
    expect(payload.device_id).toMatch(/^[0-9a-f-]{36}$/);
    // Model v2 (v1.4.0): no "Keep me signed in" box and no keep_signed_in.
    expect(payload).not.toHaveProperty("keep_signed_in");
    expect(
      screen.queryByLabelText("Keep me signed in"),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Registration received" }),
    ).toBeInTheDocument();
    expect(screen.getByText("SM-7K3Q-9XPA")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy reference" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "What happens next" }),
    ).toBeVisible();
    // The neutral message never hints at a score or status.
    expect(document.body).not.toHaveTextContent(/flag|risk|review|score/i);
  });

  it("measures session time from page open through all three steps", async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    renderJoin();
    const input = await fillRequiredFields();
    clock.mockReturnValue(start + 60_000);
    await input.click(screen.getByRole("checkbox", { name: /I agree/ }));
    await input.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => expect(portalApi.registerCustomer).toHaveBeenCalled());
    const [, payload] = vi.mocked(portalApi.registerCustomer).mock.calls[0];
    expect(payload.session_length_minutes).toBe(1);
    clock.mockRestore();
  });

  it("offers assisted mode only to the agent who owns the link", async () => {
    vi.spyOn(portalApi, "getMyReferral").mockResolvedValue({
      referral_code: CODE,
      display_name: "Amina Otieno",
      link: `http://localhost:5173/join/${CODE}`,
    });
    renderJoin(makeUser("agent"));
    await fillRequiredFields();
    expect(
      await screen.findByLabelText(
        "I am registering this customer on my device",
      ),
    ).toBeInTheDocument();
  });

  it("hides assisted mode from other agents and customers", async () => {
    vi.spyOn(portalApi, "getMyReferral").mockResolvedValue({
      referral_code: "AGT-OTHERAGT",
      display_name: "Brian Mwangi",
      link: "http://localhost:5173/join/AGT-OTHERAGT",
    });
    renderJoin(makeUser("agent"));
    await fillRequiredFields();
    await waitFor(() => expect(portalApi.getMyReferral).toHaveBeenCalled());
    expect(
      screen.queryByLabelText("I am registering this customer on my device"),
    ).not.toBeInTheDocument();
  });

  it("explains a rate-limit error without revealing anything else", async () => {
    vi.mocked(portalApi.registerCustomer).mockRejectedValue(httpError(429));
    renderJoin();
    const input = await fillRequiredFields();
    await input.click(screen.getByRole("checkbox", { name: /I agree/ }));
    await input.click(screen.getByRole("button", { name: "Register" }));
    expect(
      await screen.findByText(/Too many registrations from this network/),
    ).toBeInTheDocument();
  });

  it("says an outage is an outage, and lets the customer retry", async () => {
    vi.mocked(portalApi.getJoinLink).mockRejectedValueOnce(
      new AxiosError("Network Error", "ERR_NETWORK"),
    );
    renderJoin();
    expect(
      await screen.findByRole("heading", {
        name: "We could not check this link",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cannot reach SalesMesh/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "This link is not active" }),
    ).not.toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Full name")).toBeInTheDocument();
  });

  async function submitWithConsent() {
    const input = await fillRequiredFields();
    await input.click(screen.getByRole("checkbox", { name: /I agree/ }));
    const register = screen.getByRole("button", { name: "Register" });
    await input.click(register);
    return { input, register };
  }

  it("keeps one submission ID across a failed attempt", async () => {
    vi.mocked(portalApi.registerCustomer).mockRejectedValueOnce(
      new AxiosError("Network Error", "ERR_NETWORK"),
    );
    renderJoin();
    const { input, register } = await submitWithConsent();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Cannot reach SalesMesh.*Your details are still here/,
    );
    expect(screen.getByText("Wanjiru Kamau")).toBeInTheDocument();
    await input.click(register);

    await screen.findByText("Registration received");
    const calls = vi.mocked(portalApi.registerCustomer).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1].submission_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(calls[1][1].submission_id).toBe(calls[0][1].submission_id);
  });

  it("disables the button while the registration is being sent", async () => {
    vi.mocked(portalApi.registerCustomer).mockReturnValue(
      new Promise(() => {}),
    );
    renderJoin();
    await submitWithConsent();

    expect(
      await screen.findByRole("button", { name: "Submitting…" }),
    ).toBeDisabled();
    expect(portalApi.registerCustomer).toHaveBeenCalledTimes(1);
  });

  it("shows a refused email address next to the field", async () => {
    vi.mocked(portalApi.registerCustomer).mockRejectedValueOnce(
      httpError(422, "Use a permanent email address", "email_not_permanent"),
    );
    renderJoin();
    await submitWithConsent();

    expect(
      await screen.findByLabelText("Email address"),
    ).toHaveAccessibleDescription("Use a permanent email address");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
