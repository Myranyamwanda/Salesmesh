export type UserRole = "admin" | "agent" | "client";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  status: "pending" | "approved" | "rejected";
  is_active: boolean;
  email_verified_at: string | null;
  /** The account has a Firebase user (signed in, or created by an admin). */
  firebase_linked: boolean;
  created_at: string;
};

export type AccessTokenResponse = {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
};

/** Returned to an admin by /auth/firebase instead of tokens. */
export type MfaChallenge = {
  mfa: "setup" | "verify";
  mfa_token: string;
  expires_in: number;
};

export type MfaSetup = { secret: string; otpauth_uri: string };

export type MfaEnabledResponse = AccessTokenResponse & {
  recovery_codes: string[];
};

export type ApiErrorBody = {
  error?: { code?: string; message?: string; request_id?: string };
};
