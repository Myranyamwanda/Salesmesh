import { Button, Chip, Typography } from "@mui/material";
import ArrowForward from "@mui/icons-material/ArrowForward";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import type { UserRole } from "../types/auth";

const labels: Record<UserRole, string> = {
  admin: "Administrator workspace",
  agent: "Agent workspace",
  client: "Client workspace",
};

export function RoleHomePage({ role }: { role: UserRole }) {
  const { user, logout } = useAuth();
  if (user?.role !== role) return <Navigate to="/403" replace />;
  return (
    <main className="workspace-placeholder">
      <header className="workspace-header">
        <Link className="brand-lockup dark-lockup" to="/">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>SalesMesh</span>
        </Link>
        <Button onClick={() => void logout()} aria-label="Sign out">
          Sign out
        </Button>
      </header>
      <section className="workspace-body">
        <Chip label={role} size="small" />
        <Typography variant="h3" component="h1">
          {labels[role]}
        </Typography>
        <Typography color="text.secondary">
          You’re signed in as {user.email}.
        </Typography>
        <Typography color="text.secondary">
          Your account is active. Workspace pages will be added in Phase 5.
        </Typography>
        <Button
          component={Link}
          to="/change-password"
          variant="contained"
          endIcon={<ArrowForward />}
        >
          Change password
        </Button>
      </section>
    </main>
  );
}
