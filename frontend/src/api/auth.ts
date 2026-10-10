import { api } from "./client";
import type { AccessTokenResponse, AuthUser } from "../types/auth";

export async function login(email: string, password: string) {
  const { data } = await api.post<AccessTokenResponse>("/auth/login", {
    email,
    password,
  });
  return data;
}

export async function getMe() {
  const { data } = await api.get<AuthUser>("/auth/me");
  return data;
}

export async function registerAgent(email: string, password: string) {
  const { data } = await api.post<AuthUser>("/auth/register", {
    email,
    password,
  });
  return data;
}

export async function verifyEmail(token: string) {
  const { data } = await api.post<{ message: string }>("/auth/verify-email", {
    token,
  });
  return data;
}

export async function resendVerification(email: string) {
  const { data } = await api.post<{ message: string }>(
    "/auth/resend-verification",
    { email },
  );
  return data;
}

export async function requestPasswordReset(email: string) {
  const { data } = await api.post<{ message: string }>(
    "/auth/forgot-password",
    { email },
  );
  return data;
}

export async function resetPassword(token: string, password: string) {
  const { data } = await api.post<{ message: string }>("/auth/reset-password", {
    token,
    password,
  });
  return data;
}

export async function changePassword(
  current_password: string,
  new_password: string,
) {
  const { data } = await api.post<{ message: string }>(
    "/auth/change-password",
    { current_password, new_password },
  );
  return data;
}

export async function logout() {
  await api.post("/auth/logout");
}

export async function logoutAll() {
  await api.post("/auth/logout-all");
}
