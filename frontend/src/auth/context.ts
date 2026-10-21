import { createContext } from "react";
import type { AuthUser } from "../types/auth";

export type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  /** Keep the SalesMesh access token in memory and load the signed-in user. */
  startSession: (accessToken: string) => Promise<AuthUser>;
  /** Old SalesMesh password sign-in; removed with local passwords. */
  legacyLogin: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  clearSession: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
