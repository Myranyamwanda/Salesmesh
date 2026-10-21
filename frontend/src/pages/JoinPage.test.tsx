import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

async function fillRequiredFields() {
  const input = userEvent.setup();
  await input.type(await screen.findByLabelText("Full name"), "Wanjiru Kamau");
  await input.type(screen.getByLabelText("Email address"), "wanjiru@gmail.com");
  await input.type(screen.getByLabelText("Mobile number"), "0712345678");
  await input.type(screen.getByLabelText("Date of birth"), "1995-05-17");
  await input.type(
    screen.getByLabelText(
      "How many months have you lived at your current address?",
    ),
    "24",
  );
  return input;
}

beforeEach(() => {
  vi.spyOn(portalApi, "getJoinLink").mockResolvedValue({
    display_name: "Amina Otieno",
  });
  vi.spyOn(portalApi, "registerCustomer").mockResolvedValue({
    message: "Registration received",
  });
});

afterEach(cleanup);

describe("public join page", () => {
  it("shows the agent's display name", async () => {
    renderJoin();
    expect(
      await screen.findByText("Registering with Amina Otieno"),
    ).toBeInTheDocument();
    expect(portalApi.getJoinLink).toHaveBeenCalledWith(CODE);
  });

  it("shows a friendly page for an inactive link", async () => {
    vi.mocked(portalApi.getJoinLink).mockRejectedValue(
      httpError(404, "This link is not active"),
    );
    renderJoin();
    expect(
      await screen.findByRole("heading", { name: "This link is not active" }),
    ).toBeInTheDocument();
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
    expect(dialog).toHaveTextContent("not see them");
    expect(dialog).toHaveTextContent("privacy@example.com");
  });

  it("sends the form with device, session, and browser details", async () => {
    renderJoin();
    const input = await fillRequiredFields();
    await input.click(screen.getByLabelText("Keep me signed in"));
    await input.click(screen.getByRole("checkbox", { name: /I agree/ }));
    await input.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => expect(portalApi.registerCustomer).toHaveBeenCalled());
    const [code, payload] = vi.mocked(portalApi.registerCustomer).mock.calls[0];
    expect(code).toBe(CODE);
    expect(payload).toMatchObject({
      full_name: "Wanjiru Kamau",
      email: "wanjiru@gmail.com",
      mobile_phone: "0712345678",
      secondary_phone: null,
      date_of_birth: "1995-05-17",
      country: "KE",
      current_address_months: 24,
      previous_address_months: null,
      keep_signed_in: true,
      consent: true,
      user_agent: navigator.userAgent,
      assisted: false,
    });
    expect(payload.session_length_minutes).toBeGreaterThanOrEqual(0);
    expect(payload.device_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await screen.findByRole("heading", { name: "Registration received" }),
    ).toBeInTheDocument();
    // The neutral message never hints at a score or status.
    expect(document.body).not.toHaveTextContent(/flag|risk|review|score/i);
  });

  it("offers assisted mode only to the agent who owns the link", async () => {
    vi.spyOn(portalApi, "getMyReferral").mockResolvedValue({
      referral_code: CODE,
      display_name: "Amina Otieno",
      link: `http://localhost:5173/join/${CODE}`,
    });
    renderJoin(makeUser("agent"));
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
    await screen.findByText("Registering with Amina Otieno");
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
});
