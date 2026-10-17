import { useEffect, useRef, useState } from "react";
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
  Link as MuiLink,
  TextField,
  Typography,
} from "@mui/material";
import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";
import LinkOff from "@mui/icons-material/LinkOff";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Controller, useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import { z } from "zod";
import * as portalApi from "../api/portal";
import { useAuth } from "../hooks/useAuth";
import { apiErrorMessage } from "../utils/errors";
import {
  COUNTRY_GROUPS,
  PRIVACY_CONTACT_EMAIL,
  countryName,
  getDeviceId,
  minutesBetween,
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
  keepSignedIn: z.boolean(),
  consent: z
    .boolean()
    .refine((value) => value, "Please agree before registering"),
  assisted: z.boolean(),
});

type JoinValues = z.infer<typeof joinSchema>;

const defaults: JoinValues = {
  fullName: "",
  email: "",
  mobilePhone: "",
  secondaryPhone: "",
  dateOfBirth: "",
  country: "KE",
  currentAddressMonths: "",
  previousAddressMonths: "",
  keepSignedIn: false,
  consent: false,
  assisted: false,
};

function submitMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 429)
      return "Too many registrations from this network. Please try again later.";
    if (error.response?.status === 422)
      return "Please check the form and try again.";
  }
  return apiErrorMessage(
    error,
    "Registration is temporarily unavailable. Please try again later.",
  );
}

export function PrivacyDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
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
          Your details are seen by SalesMesh administrators only. The agent who
          shared this link does not see them.
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
      <Typography color="text.secondary">
        Please ask the person who shared it for a new registration link.
      </Typography>
    </section>
  );
}

function RegistrationReceived() {
  return (
    <section className="public-state" role="status">
      <CheckCircleOutlined className="public-state-icon" aria-hidden="true" />
      <Typography component="h1" variant="h5">
        Registration received
      </Typography>
      <Typography color="text.secondary">
        Thank you. Your details have been submitted.
      </Typography>
    </section>
  );
}

export function JoinPage() {
  const { code = "" } = useParams();
  const { user } = useAuth();
  const openedAt = useRef<number | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

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
    formState: { errors },
  } = useForm<JoinValues>({
    resolver: zodResolver(joinSchema),
    defaultValues: defaults,
  });

  const submitMutation = useMutation({
    mutationFn: (values: JoinValues) =>
      portalApi.registerCustomer(code, {
        full_name: values.fullName,
        email: values.email,
        mobile_phone: values.mobilePhone,
        secondary_phone: values.secondaryPhone || null,
        date_of_birth: values.dateOfBirth,
        country: values.country,
        current_address_months: Number(values.currentAddressMonths),
        previous_address_months:
          values.previousAddressMonths === ""
            ? null
            : Number(values.previousAddressMonths),
        keep_signed_in: values.keepSignedIn,
        consent: true,
        session_length_minutes: minutesBetween(
          openedAt.current ?? Date.now(),
          Date.now(),
        ),
        device_id: getDeviceId(),
        user_agent: navigator.userAgent,
        assisted: isOwnLink && values.assisted,
      }),
  });

  if (linkQuery.isPending) {
    return (
      <Box className="public-state">
        <CircularProgress aria-label="Checking registration link" />
      </Box>
    );
  }
  if (linkQuery.isError) {
    return <InactiveLink />;
  }
  if (submitMutation.isSuccess) {
    return <RegistrationReceived />;
  }

  return (
    <>
      <div className="form-heading">
        <p className="eyebrow">CUSTOMER REGISTRATION</p>
        <Typography component="h1" variant="h4">
          Create your account
        </Typography>
        <Typography className="form-description">
          Registering with {linkQuery.data.display_name}
        </Typography>
      </div>
      <form
        className="public-form"
        noValidate
        onSubmit={handleSubmit((values) => submitMutation.mutate(values))}
      >
        <TextField
          label="Full name"
          autoComplete="name"
          {...register("fullName")}
          error={Boolean(errors.fullName)}
          helperText={errors.fullName?.message}
        />
        <TextField
          label="Email address"
          type="email"
          autoComplete="email"
          {...register("email")}
          error={Boolean(errors.email)}
          helperText={errors.email?.message}
        />
        <TextField
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          {...register("mobilePhone")}
          error={Boolean(errors.mobilePhone)}
          helperText={errors.mobilePhone?.message ?? "For example 0712 345 678"}
        />
        <TextField
          label="Secondary phone number (optional)"
          type="tel"
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
        <TextField
          select
          label="Country"
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
        <TextField
          label="How many months have you lived at your current address?"
          inputMode="numeric"
          {...register("currentAddressMonths")}
          error={Boolean(errors.currentAddressMonths)}
          helperText={errors.currentAddressMonths?.message}
        />
        <TextField
          label="How many months did you live at your previous address? (optional)"
          inputMode="numeric"
          {...register("previousAddressMonths")}
          error={Boolean(errors.previousAddressMonths)}
          helperText={errors.previousAddressMonths?.message}
        />
        <Controller
          name="keepSignedIn"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={
                <Checkbox
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
              }
              label="Keep me signed in"
            />
          )}
        />
        {isOwnLink && (
          <Controller
            name="assisted"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={field.value}
                    onChange={(event) => field.onChange(event.target.checked)}
                  />
                }
                label="I am registering this customer on my device"
              />
            )}
          />
        )}
        <div className="consent-block">
          <Controller
            name="consent"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={field.value}
                    onChange={(event) => field.onChange(event.target.checked)}
                  />
                }
                label="I agree that SalesMesh may process my personal data for registration and fraud prevention (Kenya Data Protection Act 2019)."
              />
            )}
          />
          <MuiLink
            component="button"
            type="button"
            onClick={() => setPrivacyOpen(true)}
          >
            How we use your data
          </MuiLink>
          {errors.consent && (
            <FormHelperText error>{errors.consent.message}</FormHelperText>
          )}
        </div>
        {submitMutation.isError && (
          <Alert severity="error">{submitMessage(submitMutation.error)}</Alert>
        )}
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={submitMutation.isPending}
          fullWidth
        >
          {submitMutation.isPending ? "Submitting…" : "Register"}
        </Button>
      </form>
      <PrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </>
  );
}
