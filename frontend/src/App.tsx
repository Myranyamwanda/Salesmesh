import { useEffect } from "react";
import { Box, CircularProgress } from "@mui/material";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { AuthLayout } from "./layouts/AuthLayout";
import { WorkspaceLayout } from "./layouts/WorkspaceLayout";
import { useAuth } from "./hooks/useAuth";
import {
  ChangePasswordPage,
  ForgotPasswordPage,
  LoginPage,
  RegistrationPage,
  RegistrationPendingPage,
  ResendVerificationPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from "./pages/AuthPages";
import { AdminAuditLogPage } from "./pages/AdminAuditLogPage";
import { AdminUserManagementPage } from "./pages/AdminUserManagementPage";
import {
  AdminOverviewPage,
  AgentDashboardPage,
  AgentDetailPage,
  AgentsListPage,
  AgentTasksPage,
  ClientDashboardPage,
  ClientReportsPage,
  ModelManagementPage,
  ProfilePage,
  ReviewQueuePage,
  SystemSettingsPage,
} from "./pages/WorkspacePages";
import { ErrorPage, ForbiddenPage, NotFoundPage } from "./pages/StatusPages";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RoleRoute } from "./routes/RoleRoute";
import { roleHome } from "./utils/roleHome";

function AuthFrame() {
  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  );
}

function LoginRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <Box className="auth-loading">
        <CircularProgress aria-label="Restoring session" />
      </Box>
    );
  }
  return user ? <Navigate to={roleHome[user.role]} replace /> : <LoginPage />;
}

function CurrentWorkspaceLayout() {
  const { user } = useAuth();
  return user ? (
    <WorkspaceLayout role={user.role} />
  ) : (
    <Navigate to="/login" replace />
  );
}

function ErrorRecovery() {
  const { clearSession } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.pathname === "/session-expired") {
      clearSession();
      navigate("/login", { replace: true, state: { expired: true } });
    }
  }, [clearSession, location.pathname, navigate]);
  return <Outlet />;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route errorElement={<ErrorPage />} element={<ErrorRecovery />}>
        <Route element={<AuthFrame />}>
          <Route path="/login" element={<LoginRedirect />} />
          <Route path="/register" element={<RegistrationPage />} />
          <Route
            path="/registration-pending"
            element={<RegistrationPendingPage />}
          />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route
            path="/resend-verification"
            element={<ResendVerificationPage />}
          />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<CurrentWorkspaceLayout />}>
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
          <Route element={<RoleRoute allowed={["admin"]} />}>
            <Route element={<WorkspaceLayout role="admin" />}>
              <Route path="/admin" element={<AdminOverviewPage />} />
              <Route path="/admin/agents" element={<AgentsListPage />} />
              <Route
                path="/admin/agents/:agentId"
                element={<AgentDetailPage />}
              />
              <Route path="/admin/review-queue" element={<ReviewQueuePage />} />
              <Route path="/admin/models" element={<ModelManagementPage />} />
              <Route
                path="/admin/users"
                element={<AdminUserManagementPage />}
              />
              <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
              <Route path="/admin/settings" element={<SystemSettingsPage />} />
            </Route>
          </Route>
          <Route element={<RoleRoute allowed={["agent"]} />}>
            <Route element={<WorkspaceLayout role="agent" />}>
              <Route path="/agent" element={<AgentDashboardPage />} />
              <Route path="/agent/tasks" element={<AgentTasksPage />} />
            </Route>
          </Route>
          <Route element={<RoleRoute allowed={["client"]} />}>
            <Route element={<WorkspaceLayout role="client" />}>
              <Route path="/client" element={<ClientDashboardPage />} />
              <Route path="/client/reports" element={<ClientReportsPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="/403" element={<ForbiddenPage />} />
        <Route path="/404" element={<NotFoundPage />} />
        <Route
          path="/"
          element={
            <Navigate to={user ? roleHome[user.role] : "/login"} replace />
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
