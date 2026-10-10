import axios, { AxiosError, AxiosHeaders, type AxiosAdapter } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, authEvents, getAccessToken, setAccessToken } from "./client";

const originalAdapter = api.defaults.adapter;

afterEach(() => {
  api.defaults.adapter = originalAdapter;
  setAccessToken(null);
  vi.restoreAllMocks();
});

function unauthorizedAdapter(): AxiosAdapter {
  return async (config) => {
    const authorization = config.headers.get("Authorization");
    if (authorization === "Bearer fresh-access-token") {
      return {
        data: { ok: true },
        status: 200,
        statusText: "OK",
        headers: new AxiosHeaders(),
        config,
      };
    }
    throw new AxiosError("Unauthorized", "ERR_BAD_REQUEST", config, undefined, {
      data: {},
      status: 401,
      statusText: "Unauthorized",
      headers: new AxiosHeaders(),
      config,
    });
  };
}

describe("API access-token interceptor", () => {
  it("refreshes once and retries a protected request", async () => {
    setAccessToken(null);
    api.defaults.adapter = unauthorizedAdapter();
    const refresh = vi.spyOn(axios, "post").mockResolvedValue({
      data: { access_token: "fresh-access-token" },
    } as never);

    const response = await api.get("/protected");

    expect(response.data).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe("fresh-access-token");
  });

  it("clears memory state and signals logout when refresh fails", async () => {
    setAccessToken("expired-access-token");
    api.defaults.adapter = unauthorizedAdapter();
    vi.spyOn(axios, "post").mockRejectedValue(new Error("refresh failed"));
    const expired = vi.fn();
    window.addEventListener(authEvents.expired, expired);

    await expect(api.get("/protected")).rejects.toThrow();

    expect(getAccessToken()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    window.removeEventListener(authEvents.expired, expired);
  });
});
