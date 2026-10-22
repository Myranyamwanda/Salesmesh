import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { AccessTokenResponse } from "../types/auth";

const baseURL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
// Sign-in steps answer 401 for wrong credentials or codes; a refresh cannot help.
const signInUrls = new Set([
  "/auth/refresh",
  "/auth/firebase",
  "/auth/firebase/register",
  "/auth/mfa/setup",
  "/auth/mfa/setup/confirm",
  "/auth/mfa/verify",
]);
let accessToken: string | null = null;
let refreshInFlight: Promise<string> | null = null;

export const authEvents = {
  token: "salesmesh:access-token",
  expired: "salesmesh:session-expired",
};

export function setAccessToken(token: string | null) {
  accessToken = token;
  window.dispatchEvent(new CustomEvent(authEvents.token, { detail: token }));
}

export function getAccessToken() {
  return accessToken;
}

export const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: { Accept: "application/json" },
});

export function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post<AccessTokenResponse>(
        `${baseURL}/auth/refresh`,
        {},
        { withCredentials: true, headers: { Accept: "application/json" } },
      )
      .then(({ data }) => {
        setAccessToken(data.access_token);
        return data.access_token;
      })
      .catch((error: AxiosError) => {
        setAccessToken(null);
        window.dispatchEvent(new Event(authEvents.expired));
        throw error;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.set("Authorization", `Bearer ${accessToken}`);
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as
      (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    if (
      error.response?.status !== 401 ||
      !request ||
      request._retried ||
      signInUrls.has(request.url ?? "")
    ) {
      return Promise.reject(error);
    }
    request._retried = true;
    try {
      const refreshed = await refreshAccessToken();
      request.headers.set("Authorization", `Bearer ${refreshed}`);
      return api(request);
    } catch {
      return Promise.reject(error);
    }
  },
);
