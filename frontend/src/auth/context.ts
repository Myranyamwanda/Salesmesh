import { createContext } from "react";
import type { AuthUser } from "../types/auth";

export type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  clearSession: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
