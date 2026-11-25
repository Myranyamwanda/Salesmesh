import { useEffect, useId, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormHelperText,
  InputAdornment,
  Link as MuiLink,
  TextField,
  Typography,
} from "@mui/material";
import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";
import CloudOff from "@mui/icons-material/CloudOff";
import ContentCopy from "@mui/icons-material/ContentCopy";
import LinkOff from "@mui/icons-material/LinkOff";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { useParams } from "react-router-dom";
import { z } from "zod";
import * as portalApi from "../api/portal";
import { LogoMark, MeshMark } from "../components/VisualIdentity";
import { useAuth } from "../hooks/useAuth";
import { apiErrorCode, apiErrorMessage } from "../utils/errors";
import {
  COUNTRY_GROUPS,
  PRIVACY_CONTACT_EMAIL,
  countryName,
  getDeviceId,
  minutesBetween,
  newSubmissionId,
} from "../utils/registration";

const months = z
  .string()
  .trim()
  .regex(/^\d{1,4}$/, "Enter a whole number of months")
  .refine((value) => Number(value) <= 1200, "Enter 1200 months or fewer");

const joinSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(200, "Use 200 characters or fewer"),
  email: z.string().trim().email("Enter a valid email address").max(320),
  mobilePhone: z.string().trim().min(1, "Enter your mobile number").max(32),
  secondaryPhone: z.string().trim().max(32),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth")
    .refine(
      (value) =>
        value >= "1900-01-01" && value < new Date().toISOString().slice(0, 10),
      "Date of birth must be in the past",
    ),
  country: z.string().length(2),
  currentAddressMonths: months,
  previousAddressMonths: z.union([z.literal(""), months]),
  consent: z
    .boolean()
    .refine((value) => value, "Please agree before registering"),
  assisted: z.boolean(),
});

type JoinValues = z.infer<typeof joinSchema>;

type AddressDurationField = "currentAddressMonths" | "previousAddressMonths";

const defaults: JoinValues = {
  fullName: "",
  email: "",
  mobilePhone: "",
  secondaryPhone: "",
  dateOfBirth: "",
  country: "KE",
  currentAddressMonths: "",
  previousAddressMonths: "",
  consent: false,
  assisted: false,
};

const emailTypos: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "yaho.com": "yahoo.com",
  "outllok.com": "outlook.com",
};

function suggestedEmail(value: string) {
  const [local, domain, extra] = value.trim().split("@");
  const corrected = domain ? emailTypos[domain.toLowerCase()] : undefined;
  return local && corrected && !extra ? `${local}@${corrected}` : null;
}

function kenyanPhone(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("+254")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;
  return `+254${digits.startsWith("0") ? digits.slice(1) : digits}`;
}

function AddressDuration({
  control,
  name,
  label,
  error,
}: {
  control: Control<JoinValues>;
  name: AddressDurationField;
  label: string;
  error?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <fieldset
      className="identity-duration"
      aria-describedby={error ? errorId : undefined}
    >
      <legend>{label}</legend>
      <Controller
        name={name}
        control={control}
        render={({ field }) => {
          const total = field.value === "" ? null : Number(field.value);
          const years = total === null ? "" : String(Math.floor(total / 12));
          const months = total === null ? "" : String(total % 12);
          const update = (nextYears: string, nextMonths: string) => {
            if (nextYears === "" && nextMonths === "") {
              field.onChange("");
              return;
            }
            field.onChange(
              String(Number(nextYears || 0) * 12 + Number(nextMonths || 0)),
            );
          };
          return (
            <div className="identity-duration-selects">
              <label htmlFor={`${id}-years`}>Years</label>
              <select
                id={`${id}-years`}
                value={years}
                ref={field.ref}
                onChange={(event) => update(event.target.value, months)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
              >
                <option value="">Select</option>
                {Array.from({ length: 101 }, (_, year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              <label htmlFor={`${id}-months`}>Months</label>
              <select
                id={`${id}-months`}
                value={months}
                onChange={(event) => update(years, event.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
              >
                <option value="">Select</option>
                {Array.from({ length: 12 }, (_, month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </select>
            </div>
          );
        }}
      />
      {error && (
        <FormHelperText id={errorId} error>
          {error}
        </FormHelperText>
      )}
    </fieldset>
  );
}

function submitMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 429)
      return "Too many registrations from this network. Please try again later.";
  }
  return apiErrorMessage(
    error,
    "Registration is temporarily unavailable. Please try again later.",
  );
}

export function PrivacyDialog({
  open,
  onClose,
  clientName,
}: {
  open: boolean;
  onClose: () => void;
  clientName: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="privacy-title">
      <DialogTitle id="privacy-title">How we use your data</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>
          SalesMesh uses the details in this form to register your account and
          to prevent fraud, under the Kenya Data Protection Act 2019.
        </Typography>
        <Typography sx={{ mb: 2 }}>
          Your details are shared with {clientName}, the organisation you are
          registering for, so that it can complete your onboarding. SalesMesh
          administrators also see them. The agent who shared this link sees only
          your name and the date you registered.
        </Typography>
        <Typography>
          You can ask to see or delete your data at any time by writing to{" "}
          <MuiLink href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>
            {PRIVACY_CONTACT_EMAIL}
          </MuiLink>
          .
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function InactiveLink() {
  return (
    <section className="public-state">
      <LinkOff className="public-state-icon" aria-hidden="true" />
      <Typography component="h1" variant="h5">
        This link is not active
      </Typography>
      <Typography color="text.secondary">Contact your agent.</Typography>
    </section>
  );
}

function LinkUnavailable({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <section className="public-state" role="alert">
      <CloudOff className="public-state-icon" aria-hidden="true" />
      <Typography component="h1" variant="h5">
        We could not check this link
      </Typography>
      <Typography color="text.secondary">
        {apiErrorMessage(error, "Registration is temporarily unavailable.")}
      </Typography>
      <Button variant="contained" sx={{ mt: 2 }} onClick={onRetry}>
        Try again
      </Button>
    </section>
  );
}

function RegistrationReceived({ reference }: { reference: string }) {
  const [copyMessage, setCopyMessage] = useState("");

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopyMessage("Reference copied.");
    } catch {
      setCopyMessage(
        "Copy was unavailable. Select the reference number to copy it manually.",
      );
    }
  }

  return (
    <section className="identity-join-success" role="status">
      <MeshMark className="identity-success-illustration" />
      <span className="identity-success-check" aria-hidden="true">
        <CheckCircleOutlined />
      </span>
      <Typography component="h1" variant="h4" tabIndex={-1}>
        Registration received
      </Typography>
      <Typography color="text.secondary">
        Thank you. Your details have been submitted.
      </Typography>
      <div className="identity-reference-card">
        <Typography>Your reference number</Typography>
        <Typography
          component="p"
          variant="h5"
          className="registration-reference"
          aria-label={`Reference number ${reference}`}
        >
          {reference}
        </Typography>
        <Button
          variant="outlined"
          startIcon={<ContentCopy />}
          onClick={() => void copyReference()}
        >
          Copy reference
        </Button>
      </div>
      <Typography
        className="identity-copy-message"
        role={copyMessage.startsWith("Copy was") ? "alert" : "status"}
        aria-live="polite"
      >
        {copyMessage}
      </Typography>
      <div className="identity-next-steps">
        <Typography component="h2">What happens next</Typography>
        <Typography color="text.secondary">
          The organisation you registered for can use these details to continue
          your onboarding. Keep your reference number if you contact them.
        </Typography>
      </div>
    </section>
  );
}

const joinSteps = ["About you", "Where you live", "Review and consent"];

function ProgressSteps({ step }: { step: number }) {
  return (
    <div
      className="identity-join-progress"
      role="group"
      aria-label={`Registration progress, step ${step + 1} of ${joinSteps.length}`}
    >
      <div className="identity-progress-track" aria-hidden="true">
        {joinSteps.map((label, index) => (
          <span
            key={label}
            className={index <= step ? "identity-progress-active" : undefined}
          />
        ))}
      </div>
      <ol>
        {joinSteps.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={index === step ? "identity-step-current" : undefined}
          >
            <span className="identity-step-number">{index + 1}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TrustCard({
  clientName,
  agentName,
  onPrivacy,
}: {
  clientName: string;
  agentName: string;
  onPrivacy: () => void;
}) {
  return (
    <aside className="identity-trust-card">
      <span className="identity-trust-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <div>
        <Typography component="h2">Your details, handled with care</Typography>
        <Typography>
          {clientName} receives your details to continue onboarding. SalesMesh
          uses them for registration and fraud prevention. {agentName} sees only
          your name and registration date.
        </Typography>
        <MuiLink component="button" type="button" onClick={onPrivacy}>
          How we use your data
        </MuiLink>
      </div>
    </aside>
  );
}

function durationLabel(value: string) {
  const total = Number(value);
  const years = Math.floor(total / 12);
  const months = total % 12;
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (months || !years)
    parts.push(`${months} ${months === 1 ? "month" : "months"}`);
  return parts.join(" ");
}

export function JoinPage() {
  const { code = "" } = useParams();
  const { user } = useAuth();
  const openedAt = useRef<number | null>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  // Kept across failed attempts, so a retry can never register twice.
  const [submissionId] = useState(newSubmissionId);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);
  useEffect(() => {
    if (step > 0) stepHeading.current?.focus();
  }, [step]);

  const linkQuery = useQuery({
    queryKey: ["join", code],
    queryFn: () => portalApi.getJoinLink(code),
    retry: false,
  });
  // Assisted mode is offered only to the agent who owns this link.
  const referralQuery = useQuery({
    queryKey: ["me", "referral"],
    queryFn: portalApi.getMyReferral,
    enabled: user?.role === "agent",
  });
  const isOwnLink =
    referralQuery.data?.referral_code.toUpperCase() === code.toUpperCase();

  const {
    control,
    register,
    handleSubmit,
    setError,
    setFocus,
    setValue,
    trigger,
    getValues,
    getFieldState,
    formState: { errors },
  } = useForm<JoinValues>({
    resolver: zodResolver(joinSchema),
    defaultValues: defaults,
  });
  const emailValue = useWatch({ control, name: "email" });
  const emailSuggestion = suggestedEmail(emailValue ?? "");
  const values = getValues();

  const submitMutation = useMutation({
    mutationFn: (values: JoinValues) =>
      portalApi.registerCustomer(code, {
        full_name: values.fullName,
        email: values.email,
        mobile_phone: kenyanPhone(values.mobilePhone),
        secondary_phone: values.secondaryPhone
          ? kenyanPhone(values.secondaryPhone)
          : null,
        date_of_birth: values.dateOfBirth,
        country: values.country,
        current_address_months: Number(values.currentAddressMonths),
        previous_address_months:
          values.previousAddressMonths === ""
            ? null
            : Number(values.previousAddressMonths),
        consent: true,
        session_length_minutes: minutesBetween(
          openedAt.current ?? Date.now(),
          Date.now(),
        ),
        device_id: getDeviceId(),
        submission_id: submissionId,
        user_agent: navigator.userAgent,
        assisted: isOwnLink && values.assisted,
      }),
    onError: (error) => {
      if (apiErrorCode(error) === "email_not_permanent") {
        setStep(0);
        setError(
          "email",
          { message: apiErrorMessage(error, "Use a permanent email address") },
          { shouldFocus: true },
        );
      }
    },
  });
  useEffect(() => {
    if (step === 0 && errors.email) setFocus("email");
  }, [errors.email, setFocus, step]);
  const emailRefused =
    submitMutation.isError &&
    apiErrorCode(submitMutation.error) === "email_not_permanent";

  if (linkQuery.isPending) {
    return (
      <Box className="public-state">
        <CircularProgress aria-label="Checking registration link" />
      </Box>
    );
  }
  if (linkQuery.isError) {
    // Only a 404 means the link is inactive. An outage must not say so.
    if (
      axios.isAxiosError(linkQuery.error) &&
      linkQuery.error.response?.status === 404
    ) {
      return <InactiveLink />;
    }
    return (
      <LinkUnavailable
        error={linkQuery.error}
        onRetry={() => void linkQuery.refetch()}
      />
    );
  }
  if (submitMutation.isSuccess) {
    return <RegistrationReceived reference={submitMutation.data.reference} />;
  }
  const { display_name: agentName, client_name: clientName } = linkQuery.data;
  const stepFields =
    step === 0
      ? ([
          "fullName",
          "email",
          "mobilePhone",
          "secondaryPhone",
          "dateOfBirth",
        ] as const)
      : (["country", "currentAddressMonths", "previousAddressMonths"] as const);

  async function continueStep() {
    if (!(await trigger(stepFields))) {
      const firstInvalid = stepFields.find(
        (field) => getFieldState(field).invalid,
      );
      if (firstInvalid) setFocus(firstInvalid);
      return;
    }
    setStep((current) => Math.min(current + 1, joinSteps.length - 1));
  }

  return (
    <div className="identity-join">
      <header className="identity-join-brand">
        <LogoMark size={32} />
        <span className="identity-join-organisation">
          <span>Registration for</span>
          <strong>{clientName}</strong>
        </span>
        <span className="identity-join-agent">
          Shared by <strong>{agentName}</strong>
        </span>
      </header>
      <div className="identity-join-heading">
        <Typography component="h1" variant="h4">
          Let&apos;s get you started
        </Typography>
        <Typography className="form-description">
          A few quick details help {clientName} continue your onboarding.
        </Typography>
      </div>
      <TrustCard
        clientName={clientName}
        agentName={agentName}
        onPrivacy={() => setPrivacyOpen(true)}
      />
      <ProgressSteps step={step} />
      <form
        className="public-form identity-join-form"
        noValidate
        onSubmit={handleSubmit((values) => submitMutation.mutate(values))}
      >
        <section
          className="identity-join-step"
          aria-labelledby={`identity-step-${step}`}
        >
          <div className="identity-join-step-heading">
            <p className="identity-step-kicker">
              STEP {step + 1} OF {joinSteps.length}
            </p>
            <Typography
              component="h2"
              id={`identity-step-${step}`}
              ref={stepHeading}
              tabIndex={-1}
            >
              {joinSteps[step]}
            </Typography>
          </div>
          {step === 0 && (
            <div className="identity-step-fields">
              <TextField
                label="Full name"
                autoComplete="name"
                {...register("fullName")}
                error={Boolean(errors.fullName)}
                helperText={errors.fullName?.message}
                autoFocus
              />
              <div>
                <TextField
                  label="Email address"
                  type="email"
                  autoComplete="email"
                  {...register("email")}
                  error={Boolean(errors.email)}
                  helperText={errors.email?.message}
                />
                {emailSuggestion && (
                  <p className="identity-email-suggestion">
                    Did you mean{" "}
                    <Button
                      type="button"
                      size="small"
                      onClick={() =>
                        setValue("email", emailSuggestion, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    >
                      Use {emailSuggestion}
                    </Button>
                    ?
                  </p>
                )}
              </div>
              <TextField
                label="Mobile number"
                type="tel"
                autoComplete="tel-national"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">+254</InputAdornment>
                    ),
                  },
                  htmlInput: { inputMode: "numeric" },
                }}
                {...register("mobilePhone")}
                error={Boolean(errors.mobilePhone)}
                helperText={
                  errors.mobilePhone?.message ?? "Enter the number after +254"
                }
              />
              <TextField
                label="Secondary phone number (optional)"
                type="tel"
                autoComplete="tel-national"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">+254</InputAdornment>
                    ),
                  },
                  htmlInput: { inputMode: "numeric" },
                }}
                {...register("secondaryPhone")}
                error={Boolean(errors.secondaryPhone)}
                helperText={errors.secondaryPhone?.message}
              />
              <TextField
                label="Date of birth"
                type="date"
                autoComplete="bday"
                slotProps={{ inputLabel: { shrink: true } }}
                {...register("dateOfBirth")}
                error={Boolean(errors.dateOfBirth)}
                helperText={errors.dateOfBirth?.message}
              />
            </div>
          )}
          {step === 1 && (
            <div className="identity-step-fields">
              <TextField
                select
                label="Country"
                autoComplete="country"
                slotProps={{ select: { native: true } }}
                {...register("country")}
              >
                {COUNTRY_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.codes.map((countryCode) => (
                      <option key={countryCode} value={countryCode}>
                        {countryName(countryCode)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </TextField>
              <AddressDuration
                control={control}
                name="currentAddressMonths"
                label="Time at your current address"
                error={errors.currentAddressMonths?.message}
              />
              <AddressDuration
                control={control}
                name="previousAddressMonths"
                label="Time at your previous address (optional)"
                error={errors.previousAddressMonths?.message}
              />
            </div>
          )}
          {step === 2 && (
            <div className="identity-step-fields identity-review-fields">
              <section
                className="identity-review-card"
                aria-label="Your details"
              >
                <div>
                  <span>Name</span>
                  <strong>{values.fullName}</strong>
                </div>
                <div>
                  <span>Email</span>
                  <strong>{values.email}</strong>
                </div>
                <div>
                  <span>Mobile</span>
                  <strong>{kenyanPhone(values.mobilePhone)}</strong>
                </div>
                <div>
                  <span>Date of birth</span>
                  <strong>{values.dateOfBirth}</strong>
                </div>
                <div>
                  <span>Current address</span>
                  <strong>{durationLabel(values.currentAddressMonths)}</strong>
                </div>
                <div>
                  <span>Previous address</span>
                  <strong>
                    {values.previousAddressMonths
                      ? durationLabel(values.previousAddressMonths)
                      : "Not provided"}
                  </strong>
                </div>
              </section>
              {isOwnLink && (
                <Controller
                  name="assisted"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      className="identity-assisted-toggle"
                      control={
                        <Checkbox
                          checked={field.value}
                          onChange={(event) =>
                            field.onChange(event.target.checked)
                          }
                        />
                      }
                      label="I am registering this customer on my device"
                    />
                  )}
                />
              )}
              <div className="consent-block identity-consent">
                <Controller
                  name="consent"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={field.value}
                          onChange={(event) =>
                            field.onChange(event.target.checked)
                          }
                          slotProps={{
                            input: {
                              ref: field.ref,
                              "aria-invalid": Boolean(errors.consent),
                              "aria-describedby": errors.consent
                                ? "consent-error"
                                : undefined,
                            },
                          }}
                        />
                      }
                      label={`I agree that SalesMesh may process my personal data for registration and fraud prevention, and share my details with ${clientName} for onboarding (Kenya Data Protection Act 2019).`}
                    />
                  )}
                />
                {errors.consent && (
                  <FormHelperText id="consent-error" error>
                    {errors.consent.message}
                  </FormHelperText>
                )}
              </div>
            </div>
          )}
        </section>
        {submitMutation.isError && !emailRefused && (
          <Alert severity="error">
            {submitMessage(submitMutation.error)} Your details are still here.
          </Alert>
        )}
        <div className="identity-step-actions">
          {step > 0 && (
            <Button
              type="button"
              variant="outlined"
              onClick={() => setStep((current) => Math.max(current - 1, 0))}
            >
              Back
            </Button>
          )}
          {step < joinSteps.length - 1 ? (
            <Button
              type="button"
              variant="contained"
              onClick={() => void continueStep()}
            >
              Continue
            </Button>
          ) : (
            <Button
              type="submit"
              variant="contained"
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending ? "Submitting…" : "Register"}
            </Button>
          )}
        </div>
      </form>
      <PrivacyDialog
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
        clientName={clientName}
      />
    </div>
  );
}
