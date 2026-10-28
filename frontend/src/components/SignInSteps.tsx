/**
 * The steps between "Firebase knows who you are" and "you are signed in":
 * email verification, and an admin's authenticator code or first-time setup.
 */
import { useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import MarkEmailRead from "@mui/icons-material/MarkEmailRead";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import * as authApi from "../api/auth";
import {
  firebaseErrorMessage,
  refreshVerification,
  resendVerification,
  type FirebaseUser,
} from "../auth/firebase";
import type { MfaChallenge } from "../types/auth";
import { apiErrorCode, apiErrorMessage } from "../utils/errors";
import { AuthFeedback } from "./AuthFeedback";

export function StepHeading({
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

export function VerifyEmailStep({
  user,
  onVerified,
  onCancel,
}: {
  user: FirebaseUser;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause) ?? "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="state-symbol">
        <MarkEmailRead />
      </div>
      <StepHeading
        eyebrow="EMAIL VERIFICATION"
        title="Check your inbox"
        description={`We sent a verification link to ${user.email}. Open it, then come back and continue. It may be in your spam folder.`}
      />
      <Stack spacing={1.5}>
        <AuthFeedback error={error} success={success} />
        <Button
          variant="contained"
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (await refreshVerification(user)) onVerified();
              else
                setError(
                  "Your email is not verified yet. Open the link first.",
                );
            })
          }
        >
          I have verified my email
        </Button>
        <Button
          variant="outlined"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await resendVerification(user);
              setSuccess("A new verification email is on its way.");
            })
          }
        >
          Send the email again
        </Button>
        <Button className="text-action" disabled={busy} onClick={onCancel}>
          Use a different account
        </Button>
      </Stack>
    </>
  );
}

/** The admin's second step: a code from the authenticator app, or first setup. */
export function MfaStep({
  challenge,
  onSignedIn,
  onRestart,
}: {
  challenge: MfaChallenge;
  onSignedIn: (accessToken: string) => Promise<void>;
  onRestart: (message: string) => void;
}) {
  return challenge.mfa === "verify" ? (
    <MfaVerify
      challenge={challenge}
      onSignedIn={onSignedIn}
      onRestart={onRestart}
    />
  ) : (
    <MfaSetup
      challenge={challenge}
      onSignedIn={onSignedIn}
      onRestart={onRestart}
    />
  );
}

type MfaProps = Parameters<typeof MfaStep>[0];

function useCodeSubmit(
  submitCode: (code: string) => Promise<void>,
  onRestart: MfaProps["onRestart"],
) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await submitCode(code.trim());
    } catch (cause) {
      if (apiErrorCode(cause) === "mfa_session_expired") {
        onRestart("Your sign-in took too long. Sign in again.");
        return;
      }
      setError(apiErrorMessage(cause, "That code did not work. Try again."));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return { code, setCode, error, busy, submit };
}

function CodeField({
  code,
  setCode,
  label,
  hint,
}: {
  code: string;
  setCode: (value: string) => void;
  label: string;
  hint: string;
}) {
  return (
    <TextField
      label={label}
      value={code}
      onChange={(event) => setCode(event.target.value)}
      autoComplete="one-time-code"
      helperText={hint}
      autoFocus
      slotProps={{ htmlInput: { maxLength: 32, spellCheck: false } }}
    />
  );
}

function MfaVerify({ challenge, onSignedIn, onRestart }: MfaProps) {
  const { code, setCode, error, busy, submit } = useCodeSubmit(
    async (value) => {
      const tokens = await authApi.verifyMfa(challenge.mfa_token, value);
      await onSignedIn(tokens.access_token);
    },
    onRestart,
  );

  return (
    <>
      <StepHeading
        eyebrow="ADMIN SECURITY"
        title="Enter your code"
        description="Open your authenticator app and enter the 6-digit code for SalesMesh. Lost your phone? Enter one of your recovery codes instead."
      />
      <form className="auth-form" onSubmit={submit} noValidate>
        <CodeField
          code={code}
          setCode={setCode}
          label="Authenticator or recovery code"
          hint="For example 123456, or ABCD-EFGH-JKMN"
        />
        <AuthFeedback error={error} />
        <Button
          type="submit"
          variant="contained"
          disabled={busy || code.length < 6}
        >
          {busy ? "Checking…" : "Verify"}
        </Button>
      </form>
    </>
  );
}

function MfaSetup({ challenge, onSignedIn, onRestart }: MfaProps) {
  const [recovery, setRecovery] = useState<{
    codes: string[];
    accessToken: string;
  } | null>(null);
  // One setup per sign-in: the query cache stops a second request (for
  // example from React's development double-render) replacing the secret.
  const setup = useQuery({
    queryKey: ["mfa-setup", challenge.mfa_token],
    queryFn: () => authApi.startMfaSetup(challenge.mfa_token),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const { code, setCode, error, busy, submit } = useCodeSubmit(
    async (value) => {
      const result = await authApi.confirmMfaSetup(challenge.mfa_token, value);
      setRecovery({
        codes: result.recovery_codes,
        accessToken: result.access_token,
      });
    },
    onRestart,
  );

  if (recovery) {
    return (
      <RecoveryCodes
        codes={recovery.codes}
        onContinue={() => onSignedIn(recovery.accessToken)}
      />
    );
  }
  return (
    <>
      <StepHeading
        eyebrow="ADMIN SECURITY"
        title="Set up your authenticator"
        description="Admins confirm each sign-in with a code from an authenticator app such as Google Authenticator or Microsoft Authenticator. Scan this QR code with the app, then enter the 6-digit code it shows."
      />
      {setup.isPending && <CircularProgress aria-label="Preparing setup" />}
      {setup.isError && (
        <Alert severity="error">
          {apiErrorMessage(
            setup.error,
            "Could not start the setup. Sign in again.",
          )}
        </Alert>
      )}
      {setup.data && (
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="mfa-qr">
            <QRCodeSVG
              value={setup.data.otpauth_uri}
              size={176}
              marginSize={2}
              title="QR code for your authenticator app"
            />
          </div>
          <Typography className="form-description">
            Cannot scan? Enter this key in the app instead:
          </Typography>
          <code className="mfa-secret">{setup.data.secret}</code>
          <CodeField
            code={code}
            setCode={setCode}
            label="6-digit code"
            hint="The code changes every 30 seconds"
          />
          <AuthFeedback error={error} />
          <Button
            type="submit"
            variant="contained"
            disabled={busy || code.length !== 6}
          >
            {busy ? "Checking…" : "Turn on two-step sign-in"}
          </Button>
        </form>
      )}
    </>
  );
}

function RecoveryCodes({
  codes,
  onContinue,
}: {
  codes: string[];
  onContinue: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `SalesMesh recovery codes (each works once):\n${codes.join("\n")}\n`;

  function download() {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    link.download = "salesmesh-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <StepHeading
        eyebrow="ADMIN SECURITY"
        title="Save your recovery codes"
        description="If you lose your phone, each code lets you sign in once instead of an authenticator code. This is the only time they are shown. Keep them somewhere safe, away from your phone."
      />
      <ol className="recovery-codes" aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <Stack direction="row" spacing={1} className="step-actions">
        <Button
          variant="outlined"
          onClick={() =>
            void navigator.clipboard
              .writeText(text)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="outlined" onClick={download}>
          Download
        </Button>
      </Stack>
      <FormControlLabel
        control={
          <Checkbox checked={saved} onChange={(_, value) => setSaved(value)} />
        }
        label="I have saved these codes"
      />
      <Button
        variant="contained"
        fullWidth
        disabled={!saved || busy}
        onClick={() => {
          setBusy(true);
          void onContinue().finally(() => setBusy(false));
        }}
      >
        {busy ? "Signing in…" : "Continue"}
      </Button>
    </>
  );
}
