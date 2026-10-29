import { lazy, Suspense, useEffect } from "react";
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
import { PublicLayout } from "./layouts/PublicLayout";
import { PageLoading } from "./components/PageLoading";

// Every page loads on demand (route-level code splitting), so each user
// downloads only the pages they open, mostly those of their own role. The
// sign-in pages share one chunk (they are all in AuthPages.tsx).
const named = <Name extends string>(
  load: () => Promise<Record<Name, React.ComponentType>>,
  name: Name,
) => lazy(() => load().then((module) => ({ default: module[name] })));

const authPages = () => import("./pages/AuthPages");
const ChangePasswordPage = named(authPages, "ChangePasswordPage");
const ForgotPasswordPage = named(authPages, "ForgotPasswordPage");
const LoginPage = named(authPages, "LoginPage");
const RegistrationPage = named(authPages, "RegistrationPage");
const RegistrationPendingPage = named(authPages, "RegistrationPendingPage");
const AdminAuditLogPage = named(
  () => import("./pages/AdminAuditLogPage"),
  "AdminAuditLogPage",
);
const AdminUserManagementPage = named(
  () => import("./pages/AdminUserManagementPage"),
  "AdminUserManagementPage",
);
const AgentDetailPage = named(
  () => import("./pages/admin/AgentDetailPage"),
  "AgentDetailPage",
);
const AgentsPage = named(
  () => import("./pages/admin/AgentsPage"),
  "AgentsPage",
);
const ModelPage = named(() => import("./pages/admin/ModelPage"), "ModelPage");
const OverviewPage = named(
  () => import("./pages/admin/OverviewPage"),
  "OverviewPage",
);
const ReviewQueuePage = named(
  () => import("./pages/admin/ReviewQueuePage"),
  "ReviewQueuePage",
);
const SettingsPage = named(
  () => import("./pages/admin/SettingsPage"),
  "SettingsPage",
);
const MyCustomersPage = named(
  () => import("./pages/agent/MyCustomersPage"),
  "MyCustomersPage",
);
const ReferralPage = named(
  () => import("./pages/agent/ReferralPage"),
  "ReferralPage",
);
const EligibilityPage = named(
  () => import("./pages/admin/EligibilityPage"),
  "EligibilityPage",
);
const QualityDashboardPage = named(
  () => import("./pages/client/QualityDashboardPage"),
  "QualityDashboardPage",
);
const JoinPage = named(() => import("./pages/JoinPage"), "JoinPage");
const ProfilePage = named(() => import("./pages/ProfilePage"), "ProfilePage");
import { ErrorPage, ForbiddenPage, NotFoundPage } from "./pages/StatusPages";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RoleRoute } from "./routes/RoleRoute";
import { roleHome } from "./utils/roleHome";

function AuthFrame() {
  return (
    <AuthLayout>
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
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
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route errorElement={<ErrorPage />} element={<ErrorRecovery />}>
          <Route element={<AuthFrame />}>
            <Route path="/login" element={<LoginRedirect />} />
            <Route path="/register" element={<RegistrationPage />} />
            <Route
              path="/registration-pending"
              element={<RegistrationPendingPage />}
            />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>
          {/* Public: customers register without signing in. */}
          <Route element={<PublicLayout />}>
            <Route path="/join/:code" element={<JoinPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route element={<CurrentWorkspaceLayout />}>
              <Route path="/change-password" element={<ChangePasswordPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>
            <Route element={<RoleRoute allowed={["admin"]} />}>
              <Route element={<WorkspaceLayout role="admin" />}>
                <Route path="/admin" element={<OverviewPage />} />
                <Route path="/admin/agents" element={<AgentsPage />} />
                <Route
                  path="/admin/agents/:agentId"
                  element={<AgentDetailPage />}
                />
                <Route
                  path="/admin/review-queue"
                  element={<ReviewQueuePage />}
                />
                <Route
                  path="/admin/eligibility"
                  element={<EligibilityPage />}
                />
                <Route path="/admin/models" element={<ModelPage />} />
                <Route
                  path="/admin/users"
                  element={<AdminUserManagementPage />}
                />
                <Route
                  path="/admin/audit-log"
                  element={<AdminAuditLogPage />}
                />
                <Route path="/admin/settings" element={<SettingsPage />} />
              </Route>
            </Route>
            <Route element={<RoleRoute allowed={["agent"]} />}>
              <Route element={<WorkspaceLayout role="agent" />}>
                <Route path="/agent" element={<ReferralPage />} />
                <Route path="/agent/customers" element={<MyCustomersPage />} />
              </Route>
            </Route>
            <Route element={<RoleRoute allowed={["client"]} />}>
              <Route element={<WorkspaceLayout role="client" />}>
                <Route path="/client" element={<QualityDashboardPage />} />
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
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
