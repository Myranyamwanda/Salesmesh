import { useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Divider,
  Link as MuiLink,
  TextField,
  Typography,
} from "@mui/material";
import ArrowForward from "@mui/icons-material/ArrowForward";
import TaskAlt from "@mui/icons-material/TaskAlt";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { z } from "zod";
import * as authApi from "../api/auth";
import { useAuth } from "../hooks/useAuth";
import { FormTextField } from "../components/FormTextField";
import { PasswordField } from "../components/PasswordField";
import { AuthFeedback } from "../components/AuthFeedback";
import { apiErrorMessage } from "../utils/errors";
import { roleHome } from "../utils/roleHome";

const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address")
  .max(320);
const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use no more than 128 characters")
  .regex(/[a-z]/, "Add a lowercase letter")
  .regex(/[A-Z]/, "Add an uppercase letter")
  .regex(/\d/, "Add a number")
  .regex(/[^a-zA-Z0-9\s]/, "Add a symbol");

const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(128),
});
const registrationSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
const emailFormSchema = z.object({ email: emailSchema });
const resetSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
const changeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(128),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type Credentials = z.infer<typeof credentialsSchema>;
type RegistrationValues = z.infer<typeof registrationSchema>;
type EmailValues = z.infer<typeof emailFormSchema>;
type ResetValues = z.infer<typeof resetSchema>;
type ChangeValues = z.infer<typeof changeSchema>;

function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="form-heading">
      <p className="eyebrow">{eyebrow}</p>
      <Typography component="h1" variant="h4">
        {title}
      </Typography>
      <Typography className="form-description">{description}</Typography>
    </header>
  );
}

function FormFooter({ children }: { children: React.ReactNode }) {
  return <div className="form-footer">{children}</div>;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState("");
  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  async function submit(values: Credentials) {
    setServerError("");
    try {
      const user = await login(values.email, values.password);
      navigate(roleHome[user.role], { replace: true });
    } catch (error) {
      setServerError(
        apiErrorMessage(
          error,
          "We could not sign you in. Check your details and try again.",
        ),
      );
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="WELCOME BACK"
        title="Sign in"
        description="Enter your account details to continue."
      />
      <form className="auth-form" onSubmit={handleSubmit(submit)} noValidate>
        <FormTextField
          label="Email address"
          type="email"
          autoComplete="email"
          registration={register("email")}
          error={errors.email?.message}
          autoFocus
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          registration={register("password")}
          error={errors.password?.message}
        />
        <div className="form-inline-link">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <AuthFeedback error={serverError} />
        <Button
          type="submit"
          variant="contained"
          disabled={isSubmitting}
          endIcon={<ArrowForward />}
          fullWidth
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <FormFooter>
        New to SalesMesh? <Link to="/register">Create an agent account</Link>
      </FormFooter>
    </>
  );
}

export function RegistrationPage() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState("");
  const form = useForm<RegistrationValues>({
    resolver: zodResolver(registrationSchema),
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  async function submit(values: RegistrationValues) {
    setServerError("");
    try {
      await authApi.registerAgent(values.email, values.password);
      navigate("/registration-pending", {
        replace: true,
        state: { email: values.email },
      });
    } catch (error) {
      setServerError(
        apiErrorMessage(
          error,
          "We could not complete registration. Try again.",
        ),
      );
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="AGENT ACCESS"
        title="Create your account"
        description="Register as an agent to request access to the workspace."
      />
      <form className="auth-form" onSubmit={handleSubmit(submit)} noValidate>
        <FormTextField
          label="Email address"
          type="email"
          autoComplete="email"
          registration={register("email")}
          error={errors.email?.message}
          autoFocus
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          registration={register("password")}
          error={errors.password?.message}
          hint="12–128 characters with upper, lower, number, and symbol"
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          registration={register("confirmPassword")}
          error={errors.confirmPassword?.message}
        />
        <AuthFeedback error={serverError} />
        <Button
          type="submit"
          variant="contained"
          disabled={isSubmitting}
          endIcon={<ArrowForward />}
          fullWidth
        >
          {isSubmitting ? "Creating account…" : "Request agent access"}
        </Button>
      </form>
      <FormFooter>
        Already registered? <Link to="/login">Sign in</Link>
      </FormFooter>
    </>
  );
}

export function RegistrationPendingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(
    searchParams.get("email") ?? location.state?.email ?? "",
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);

  async function resend(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = await authApi.resendVerification(email);
      setSuccess(result.message);
    } catch (cause) {
      setError(
        apiErrorMessage(cause, "We could not send a verification email."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="state-symbol">
        <TaskAlt />
      </div>
      <PageHeading
        eyebrow="REQUEST RECEIVED"
        title="You’re in the review queue"
        description="Your agent account is pending administrator approval. Verify your email while you wait; sign-in becomes available once both steps are complete."
      />
      <Divider className="section-divider" />
      <form className="auth-form compact-form" onSubmit={resend}>
        <TextField
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 320 } }}
        />
        <AuthFeedback error={error} success={success} />
        <Button
          type="submit"
          variant="outlined"
          disabled={isSubmitting || !email}
          fullWidth
        >
          {isSubmitting ? "Sending…" : "Resend verification email"}
        </Button>
      </form>
      <FormFooter>
        <MuiLink component={Link} to="/login">
          Return to sign in
        </MuiLink>
      </FormFooter>
      <Button className="text-action" onClick={() => navigate("/login")}>
        Go to sign in
      </Button>
    </>
  );
}

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);

  async function verify() {
    setSubmitting(true);
    setError("");
    try {
      await authApi.verifyEmail(token);
      setSuccess(true);
    } catch (cause) {
      setError(
        apiErrorMessage(cause, "This verification link is invalid or expired."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="EMAIL VERIFICATION"
        title={success ? "Email verified" : "Verify your email"}
        description={
          success
            ? "Your email address is confirmed. Agent accounts still need administrator approval before sign-in."
            : "Confirm the email address used for your SalesMesh account."
        }
      />
      <AuthFeedback error={error} />
      {success ? (
        <Button
          variant="contained"
          onClick={() => navigate("/login")}
          fullWidth
        >
          Continue to sign in
        </Button>
      ) : (
        <Button
          variant="contained"
          onClick={verify}
          disabled={isSubmitting || !token}
          fullWidth
        >
          {isSubmitting ? "Verifying…" : "Verify email"}
        </Button>
      )}
      {!token && (
        <Alert severity="warning">
          This link is missing its verification token. Request another from the
          registration screen.
        </Alert>
      )}
    </>
  );
}

function EmailRequestPage({ reset = false }: { reset?: boolean }) {
  const [success, setSuccess] = useState("");
  const [serverError, setServerError] = useState("");
  const form = useForm<EmailValues>({ resolver: zodResolver(emailFormSchema) });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  async function submit(values: EmailValues) {
    setServerError("");
    try {
      const result = reset
        ? await authApi.requestPasswordReset(values.email)
        : await authApi.resendVerification(values.email);
      setSuccess(result.message);
    } catch (error) {
      setServerError(
        apiErrorMessage(error, "We could not process that request. Try again."),
      );
    }
  }

  return (
    <>
      <PageHeading
        eyebrow={reset ? "ACCOUNT RECOVERY" : "EMAIL VERIFICATION"}
        title={reset ? "Reset your password" : "Resend verification"}
        description={
          reset
            ? "Enter your account email. If it is eligible, we’ll send a reset link."
            : "Enter your account email and we’ll resend the verification link if it is still needed."
        }
      />
      <form className="auth-form" onSubmit={handleSubmit(submit)} noValidate>
        <FormTextField
          label="Email address"
          type="email"
          autoComplete="email"
          registration={register("email")}
          error={errors.email?.message}
          autoFocus
        />
        <AuthFeedback error={serverError} success={success} />
        <Button
          type="submit"
          variant="contained"
          disabled={isSubmitting}
          fullWidth
        >
          {isSubmitting
            ? "Sending…"
            : reset
              ? "Send reset link"
              : "Send verification link"}
        </Button>
      </form>
      <FormFooter>
        <Link to="/login">Return to sign in</Link>
      </FormFooter>
    </>
  );
}

export function ForgotPasswordPage() {
  return <EmailRequestPage reset />;
}

export function ResendVerificationPage() {
  return <EmailRequestPage />;
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [serverError, setServerError] = useState("");
  const [success, setSuccess] = useState("");
  const form = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  async function submit(values: ResetValues) {
    setServerError("");
    try {
      const result = await authApi.resetPassword(token, values.password);
      setSuccess(result.message);
    } catch (error) {
      setServerError(
        apiErrorMessage(error, "This reset link is invalid or expired."),
      );
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ACCOUNT RECOVERY"
        title="Choose a new password"
        description="Use a unique password that meets the security requirements."
      />
      {!token && (
        <Alert severity="warning">This link is missing its reset token.</Alert>
      )}
      <form className="auth-form" onSubmit={handleSubmit(submit)} noValidate>
        <PasswordField
          label="New password"
          autoComplete="new-password"
          registration={register("password")}
          error={errors.password?.message}
          hint="12–128 characters with upper, lower, number, and symbol"
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          registration={register("confirmPassword")}
          error={errors.confirmPassword?.message}
        />
        <AuthFeedback error={serverError} success={success} />
        {success ? (
          <Button
            variant="contained"
            onClick={() => navigate("/login")}
            fullWidth
          >
            Return to sign in
          </Button>
        ) : (
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting || !token}
            fullWidth
          >
            {isSubmitting ? "Updating…" : "Update password"}
          </Button>
        )}
      </form>
    </>
  );
}

export function ChangePasswordPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState("");
  const [success, setSuccess] = useState("");
  const form = useForm<ChangeValues>({ resolver: zodResolver(changeSchema) });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  async function submit(values: ChangeValues) {
    setServerError("");
    try {
      const result = await authApi.changePassword(
        values.currentPassword,
        values.password,
      );
      setSuccess(result.message);
      await logout().catch(() => undefined);
      navigate("/login", { replace: true });
    } catch (error) {
      setServerError(
        apiErrorMessage(error, "We could not update your password."),
      );
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ACCOUNT SECURITY"
        title="Change password"
        description="Confirm your current password, then choose a new one."
      />
      <form className="auth-form" onSubmit={handleSubmit(submit)} noValidate>
        <PasswordField
          label="Current password"
          autoComplete="current-password"
          registration={register("currentPassword")}
          error={errors.currentPassword?.message}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          registration={register("password")}
          error={errors.password?.message}
          hint="12–128 characters with upper, lower, number, and symbol"
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          registration={register("confirmPassword")}
          error={errors.confirmPassword?.message}
        />
        <AuthFeedback error={serverError} success={success} />
        <Button
          type="submit"
          variant="contained"
          disabled={isSubmitting}
          fullWidth
        >
          {isSubmitting ? "Updating…" : "Change password"}
        </Button>
      </form>
    </>
  );
}

export function RegistrationPendingContent() {
  return (
    <Typography variant="body2">
      Your account request is awaiting review.
    </Typography>
  );
}
