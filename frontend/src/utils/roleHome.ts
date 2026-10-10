import type { UserRole } from "../types/auth";

export const roleHome: Record<UserRole, string> = {
  admin: "/admin",
  agent: "/agent",
  client: "/client",
};
