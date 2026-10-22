import { api } from "./client";
import type {
  AccessTokenResponse,
  AuthUser,
  MfaChallenge,
  MfaEnabledResponse,
  MfaSetup,
} from "../types/auth";

/**
 * Exchange a Firebase ID token for the SalesMesh session. Agents and clients
 * get tokens at once; an admin gets an MFA challenge first.
 */
export async function exchangeFirebaseToken(idToken: string) {
  const { data } = await api.post<AccessTokenResponse | MfaChallenge>(
    "/auth/firebase",
    { id_token: idToken },
  );
  return data;
}

/** Create a pending agent for a verified Firebase account. */
export async function registerAgent(idToken: string, displayName: string) {
  const { data } = await api.post<AuthUser>("/auth/firebase/register", {
    id_token: idToken,
    display_name: displayName,
  });
  return data;
}

export async function startMfaSetup(mfaToken: string) {
  const { data } = await api.post<MfaSetup>("/auth/mfa/setup", {
    mfa_token: mfaToken,
  });
  return data;
}

export async function confirmMfaSetup(mfaToken: string, code: string) {
  const { data } = await api.post<MfaEnabledResponse>(
    "/auth/mfa/setup/confirm",
    { mfa_token: mfaToken, code },
  );
  return data;
}

export async function verifyMfa(mfaToken: string, code: string) {
  const { data } = await api.post<AccessTokenResponse>("/auth/mfa/verify", {
    mfa_token: mfaToken,
    code,
  });
  return data;
}

export async function getMe() {
  const { data } = await api.get<AuthUser>("/auth/me");
  return data;
}

export async function logout() {
  await api.post("/auth/logout");
}

export async function logoutAll() {
  await api.post("/auth/logout-all");
}
