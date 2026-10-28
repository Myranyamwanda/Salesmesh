import { useState } from "react";
import { Alert, Button, Divider } from "@mui/material";
import ArrowForward from "@mui/icons-material/ArrowForward";
import Google from "@mui/icons-material/Google";
import TaskAlt from "@mui/icons-material/TaskAlt";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import * as authApi from "../api/auth";
import {
  changePassword,
  currentFirebaseUser,
  firebaseErrorCode,
  firebaseErrorMessage,
  idToken,
  sendPasswordReset,
  signInWithGoogle,
  signInWithPassword,
  signOutOfFirebase,
  signUpWithPassword,
  wasCancelled,
  type FirebaseUser,
} from "../auth/firebase";
import { AuthFeedback } from "../components/AuthFeedback";
import { FormTextField } from "../components/FormTextField";
import { PasswordField } from "../components/PasswordField";
import {
  MfaStep,
  StepHeading as PageHeading,
  VerifyEmailStep,
} from "../components/SignInSteps";
import { useAuth } from "../hooks/useAuth";
import type { MfaChallenge } from "../types/auth";
import { apiErrorCode, apiErrorMessage } from "../utils/errors";
import { roleHome } from "../utils/roleHome";

const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address")
  .max(320);
// The SalesMesh password rule. Firebase on the free (Spark) plan cannot
// enforce a custom policy, so the sign-up and change-password forms do.
const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use no more than 128 characters")
  .regex(/[a-z]/, "Add a lowercase letter")
  .regex(/[A-Z]/, "Add an uppercase letter")
  .regex(/\d/, "Add a number")
  .regex(/[^a-zA-Z0-9\s]/, "Add a symbol");
const PASSWORD_HINT = "12–128 characters with upper, lower, number, and symbol";

const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(128),
});
const signUpSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
const displayNameSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Enter the name customers will see")
    .max(100, "Use 100 characters or fewer"),
});
const emailFormSchema = z.object({ email: emailSchema });
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
type SignUpValues = z.infer<typeof signUpSchema>;
type DisplayNameValues = z.infer<typeof displayNameSchema>;
type EmailValues = z.infer<typeof emailFormSchema>;
type ChangeValues = z.infer<typeof changeSchema>;

function FormFooter({ children }: { children: React.ReactNode }) {
  return <div className="form-footer">{children}</div>;
}

function signInError(error: unknown, fallback: string) {
  return firebaseErrorMessage(error) ?? apiErrorMessage(error, fallback);
}

function GoogleButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <>
      <Divider className="or-divider">or</Divider>
      <Button
        variant="outlined"
        startIcon={<Google />}
        disabled={disabled}
        onClick={onClick}
        fullWidth
      >
        {label}
      </Button>
    </>
  );
}

type LoginStep =
  | { name: "credentials" }
  | { name: "verify-email"; user: FirebaseUser }
  | { name: "no-account"; email: string }
  | { name: "mfa"; challenge: MfaChallenge };

/**
 * Sign in with Firebase (password or Google), then exchange the Firebase ID
 * token for the SalesMesh session. Admins then enter an authenticator code.
 */
export function LoginPage() {
  const { startSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState<LoginStep>({ name: "credentials" });
  const [serverError, setServerError] = useState(
    location.state?.expired ? "Your session expired. Sign in again." : "",
  );
  const [busy, setBusy] = useState(false);
  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  async function enter(accessToken: string) {
    const user = await startSession(accessToken);
    navigate(roleHome[user.role], { replace: true });
  }

  async function restart(message = "") {
    await signOutOfFirebase().catch(() => undefined);
    setStep({ name: "credentials" });
    setServerError(message);
  }

  /** After Firebase sign-in: hand the verified identity to SalesMesh. */
  async function exchange(user: FirebaseUser) {
    if (!user.emailVerified) {
      setStep({ name: "verify-email", user });
      return;
    }
    try {
      const result = await authApi.exchangeFirebaseToken(await idToken(user));
      // The Firebase sign-in has done its job; SalesMesh holds the session.
      await signOutOfFirebase();
      if ("mfa" in result) setStep({ name: "mfa", challenge: result });
      else await enter(result.access_token);
    } catch (error) {
      const code = apiErrorCode(error);
      if (code === "account_not_found") {
        // Stay signed in to Firebase so the agent can finish registering.
        setStep({ name: "no-account", email: user.email ?? "" });
      } else if (code === "email_not_verified") {
        setStep({ name: "verify-email", user });
      } else if (code === "account_pending") {
        await signOutOfFirebase();
        navigate("/registration-pending", { replace: true });
      } else {
        await restart(
          signInError(error, "We could not sign you in. Try again."),
        );
      }
    }
  }

  async function attempt(signIn: () => Promise<FirebaseUser>) {
    setServerError("");
    setBusy(true);
    try {
      await exchange(await signIn());
    } catch (error) {
      if (!wasCancelled(error)) {
        setServerError(signInError(error, "We could not sign you in."));
      }
    } finally {
      setBusy(false);
    }
  }

  if (step.name === "verify-email") {
    return (
      <VerifyEmailStep
        user={step.user}
        onVerified={() => void attempt(async () => step.user)}
        onCancel={() => void restart()}
      />
    );
  }
  if (step.name === "mfa") {
    return (
      <MfaStep
        challenge={step.challenge}
        onSignedIn={enter}
        onRestart={(message) => void restart(message)}
      />
    );
  }
  if (step.name === "no-account") {
    return (
      <>
        <PageHeading
          eyebrow="NO ACCOUNT YET"
          title="This email has no SalesMesh account"
          description={`${step.email} is not registered. Agents can request access now. Admin and client accounts are created by an administrator.`}
        />
        <Button
          variant="contained"
          fullWidth
          onClick={() => navigate("/register")}
        >
          Request agent access
        </Button>
        <Button className="text-action" onClick={() => void restart()}>
          Use a different account
        </Button>
      </>
    );
  }
  return (
    <>
      <PageHeading
        eyebrow="WELCOME BACK"
        title="Sign in"
        description="Enter your account details to continue."
      />
      <form
        className="auth-form"
        onSubmit={handleSubmit((values) =>
          attempt(() => signInWithPassword(values.email, values.password)),
        )}
        noValidate
      >
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
          disabled={busy}
          endIcon={<ArrowForward />}
          fullWidth
        >
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <GoogleButton
          label="Sign in with Google"
          disabled={busy}
          onClick={() => void attempt(signInWithGoogle)}
        />
      </form>
      <FormFooter>
        New to SalesMesh? <Link to="/register">Create an agent account</Link>
      </FormFooter>
    </>
  );
}

/**
 * Agent self-registration: create (or reuse) a Firebase account, verify the
 * email, then give the display name. The backend creates a pending agent.
 */
export function RegistrationPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<FirebaseUser | null>(currentFirebaseUser);
  const [verified, setVerified] = useState(user?.emailVerified ?? false);
  const [serverError, setServerError] = useState("");
  const [notPermanent, setNotPermanent] = useState(false);
  const [busy, setBusy] = useState(false);
  const accountForm = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
  });
  const nameForm = useForm<DisplayNameValues>({
    resolver: zodResolver(displayNameSchema),
  });

  async function startOver(message = "") {
    await signOutOfFirebase().catch(() => undefined);
    setUser(null);
    setVerified(false);
    setNotPermanent(false);
    setServerError(message);
  }

  async function createAccount(create: () => Promise<FirebaseUser>) {
    setServerError("");
    setBusy(true);
    try {
      const created = await create();
      setUser(created);
      setVerified(created.emailVerified);
    } catch (error) {
      if (!wasCancelled(error)) {
        setServerError(
          signInError(error, "We could not create your account. Try again."),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function finish(values: DisplayNameValues) {
    if (!user) return;
    setServerError("");
    try {
      await authApi.registerAgent(await idToken(user), values.displayName);
      await signOutOfFirebase();
      navigate("/registration-pending", { replace: true });
    } catch (error) {
      const code = apiErrorCode(error);
      if (code === "account_exists") {
        // An existing SalesMesh account: the Firebase sign-in just created
        // links to it at the next sign-in (matched by the verified email).
        await startOver(
          "You already have a SalesMesh account with this email. Sign in with this email and the password you just chose.",
        );
      } else {
        setNotPermanent(code === "email_not_permanent");
        setServerError(
          signInError(error, "We could not complete registration. Try again."),
        );
      }
    }
  }

  if (user && !verified) {
    return (
      <VerifyEmailStep
        user={user}
        onVerified={() => setVerified(true)}
        onCancel={() => void startOver()}
      />
    );
  }
  if (user) {
    const {
      register,
      handleSubmit,
      formState: { errors, isSubmitting },
    } = nameForm;
    return (
      <>
        <PageHeading
          eyebrow="AGENT ACCESS"
          title="One last step"
          description={`Signed in as ${user.email}. Choose the name customers will see on your registration link.`}
        />
        <form className="auth-form" onSubmit={handleSubmit(finish)} noValidate>
          <FormTextField
            label="Display name"
            autoComplete="name"
            registration={register("displayName")}
            error={errors.displayName?.message}
            hint="Shown to customers on your registration link"
            autoFocus
          />
          <AuthFeedback error={serverError} />
          {notPermanent && (
            <Alert severity="info">
              Disposable or mail-less addresses cannot be used. Start again with
              a permanent email address.
            </Alert>
          )}
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting}
            endIcon={<ArrowForward />}
            fullWidth
          >
            {isSubmitting ? "Sending request…" : "Request agent access"}
          </Button>
        </form>
        <FormFooter>
          <Button className="text-action" onClick={() => void startOver()}>
            Use a different email
          </Button>
        </FormFooter>
      </>
    );
  }
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = accountForm;
  return (
    <>
      <PageHeading
        eyebrow="AGENT ACCESS"
        title="Create your account"
        description="Register as an agent to request access to the workspace. An administrator approves new agents."
      />
      <form
        className="auth-form"
        onSubmit={handleSubmit((values) =>
          createAccount(() =>
            signUpWithPassword(values.email, values.password),
          ),
        )}
        noValidate
      >
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
          hint={PASSWORD_HINT}
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
          disabled={busy}
          endIcon={<ArrowForward />}
          fullWidth
        >
          {busy ? "Creating account…" : "Create account"}
        </Button>
        <GoogleButton
          label="Sign up with Google"
          disabled={busy}
          onClick={() => void createAccount(signInWithGoogle)}
        />
      </form>
      <FormFooter>
        Already registered? <Link to="/login">Sign in</Link>
      </FormFooter>
    </>
  );
}

export function RegistrationPendingPage() {
  return (
    <>
      <div className="state-symbol">
        <TaskAlt />
      </div>
      <PageHeading
        eyebrow="REQUEST RECEIVED"
        title="You’re in the review queue"
        description="Your agent account is waiting for administrator approval. You can sign in as soon as it is approved."
      />
      <FormFooter>
        <Link to="/login">Return to sign in</Link>
      </FormFooter>
    </>
  );
}

export function ForgotPasswordPage() {
  const [success, setSuccess] = useState("");
  const [serverError, setServerError] = useState("");
  const form = useForm<EmailValues>({ resolver: zodResolver(emailFormSchema) });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;
  const sent =
    "If an account uses this email, we have sent a link to choose a new password. Check your spam folder too.";

  async function submit(values: EmailValues) {
    setServerError("");
    try {
      await sendPasswordReset(values.email);
      setSuccess(sent);
    } catch (error) {
      // Never reveal whether an account exists.
      if (firebaseErrorCode(error) === "auth/user-not-found") setSuccess(sent);
      else setServerError(signInError(error, "We could not send the email."));
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ACCOUNT RECOVERY"
        title="Reset your password"
        description="Enter your account email and we’ll send a link to choose a new password. Accounts that sign in with Google do not need one."
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
          {isSubmitting ? "Sending…" : "Send reset link"}
        </Button>
      </form>
      <FormFooter>
        <Link to="/login">Return to sign in</Link>
      </FormFooter>
    </>
  );
}

export function ChangePasswordPage() {
  const { user, logoutAll } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState("");
  const form = useForm<ChangeValues>({ resolver: zodResolver(changeSchema) });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  async function submit(values: ChangeValues) {
    if (!user) return;
    setServerError("");
    try {
      await changePassword(user.email, values.currentPassword, values.password);
    } catch (error) {
      const code = firebaseErrorCode(error);
      setServerError(
        code === "auth/invalid-credential" || code === "auth/wrong-password"
          ? "Your current password is not correct. If you sign in with Google, change your password in your Google account instead."
          : signInError(error, "We could not update your password."),
      );
      return;
    }
    // Like before: a new password ends every session, including this one.
    await logoutAll().catch(() => undefined);
    navigate("/login", { replace: true });
  }

  return (
    <>
      <PageHeading
        eyebrow="ACCOUNT SECURITY"
        title="Change password"
        description="Confirm your current password, then choose a new one. You will be signed out everywhere."
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
          hint={PASSWORD_HINT}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          registration={register("confirmPassword")}
          error={errors.confirmPassword?.message}
        />
        <AuthFeedback error={serverError} />
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
