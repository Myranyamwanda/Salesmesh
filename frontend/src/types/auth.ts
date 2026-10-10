export type UserRole = "admin" | "agent" | "client";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  status: "pending" | "approved" | "rejected";
  is_active: boolean;
  email_verified_at: string | null;
  created_at: string;
};

export type AccessTokenResponse = {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
};

export type ApiErrorBody = {
  error?: { code?: string; message?: string; request_id?: string };
};
