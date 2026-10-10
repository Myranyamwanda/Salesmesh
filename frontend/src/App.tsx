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
import { RoleHomePage } from "./pages/RoleHomePage";
import { ErrorPage, ForbiddenPage, NotFoundPage } from "./pages/StatusPages";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RoleRoute } from "./routes/RoleRoute";
import type { UserRole } from "./types/auth";
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
          <Route element={<RoleRoute allowed={["admin", "agent", "client"]} />}>
            <Route
              path="/change-password"
              element={
                <AuthLayout>
                  <ChangePasswordPage />
                </AuthLayout>
              }
            />
          </Route>
          {(["admin", "agent", "client"] as UserRole[]).map((role) => (
            <Route key={role} element={<RoleRoute allowed={[role]} />}>
              <Route
                path={roleHome[role]}
                element={<RoleHomePage role={role} />}
              />
            </Route>
          ))}
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
