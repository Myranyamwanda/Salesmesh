import { Navigate, Outlet } from "react-router-dom";
import type { UserRole } from "../types/auth";
import { useAuth } from "../hooks/useAuth";

export function RoleRoute({ allowed }: { allowed: UserRole[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return allowed.includes(user.role) ? (
    <Outlet />
  ) : (
    <Navigate to="/403" replace />
  );
}
