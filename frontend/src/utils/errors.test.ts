import { AxiosError, type AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "./errors";

function withBody(data: unknown) {
  return new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, {
    status: 502,
    data,
  } as AxiosResponse);
}

describe("apiErrorMessage", () => {
  it("uses the API's own message", () => {
    const error = withBody({ error: { message: "Link expired" } });
    expect(apiErrorMessage(error, "Fallback")).toBe("Link expired");
  });

  it("names a connection failure", () => {
    const error = new AxiosError("Network Error", "ERR_NETWORK");
    expect(apiErrorMessage(error, "Fallback")).toMatch(
      /Cannot reach SalesMesh/,
    );
  });

  it("names a timeout", () => {
    const error = new AxiosError("timeout", "ECONNABORTED");
    expect(apiErrorMessage(error, "Fallback")).toMatch(/took too long/);
  });

  it("falls back for a response without a JSON body", () => {
    expect(apiErrorMessage(withBody("<html>"), "Fallback")).toBe("Fallback");
    expect(apiErrorMessage(withBody(undefined), "Fallback")).toBe("Fallback");
  });
});
