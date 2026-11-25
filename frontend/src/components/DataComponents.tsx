import type { ReactNode } from "react";
import type {
  Band,
  CustomerStatus,
  Eligibility,
  ReasonSource,
  RegistrationStatus,
} from "../types/scoring";
import { Alert, Chip, Paper, Typography } from "@mui/material";
import { apiErrorMessage } from "../utils/errors";
import { BandStatus, StatusBadge, type Tone } from "./table/StatusBadge";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="workspace-page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <Typography component="h1" variant="h4">
          {title}
        </Typography>
        {description && (
          <Typography color="text.secondary">{description}</Typography>
        )}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({
  title = "Nothing to show yet",
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="data-empty-state">
      <span className="empty-rule" aria-hidden="true" />
      <Typography component="h3" variant="h6">
        {title}
      </Typography>
      {description && (
        <Typography color="text.secondary">{description}</Typography>
      )}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  detail,
}: {
  label: string;
  value?: string | number | null;
  detail?: string;
}) {
  return (
    <Paper className="kpi-card" variant="outlined" square>
      <Typography className="kpi-label">{label}</Typography>
      <Typography className="kpi-value">
        {value ?? <span aria-label="Not available">—</span>}
      </Typography>
      {detail && (
        <Typography className="kpi-detail" color="text.secondary">
          {detail}
        </Typography>
      )}
    </Paper>
  );
}

export function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <Paper className="chart-card" variant="outlined" square>
      <div className="chart-card-heading">
        <Typography component="h2" variant="h6">
          {title}
        </Typography>
        {description && (
          <Typography color="text.secondary">{description}</Typography>
        )}
      </div>
      {children}
    </Paper>
  );
}

// Badges always show a text label and an icon, so meaning never depends on
// colour alone. They are the tinted StatusBadge from components/table.
export function BandBadge({ band }: { band: Band }) {
  return <BandStatus band={band} />;
}

const sourceChips = {
  model: { label: "Model", color: "primary" },
  rule: { label: "Rule", color: "secondary" },
  audit: { label: "Audit", color: "default" },
} as const;

/** Where a reason came from: a label, not a status, so an outlined chip. */
export function SourceChip({ source }: { source: ReasonSource }) {
  const { label, color } = sourceChips[source] ?? sourceChips.model;
  return <Chip size="small" variant="outlined" color={color} label={label} />;
}

/** Admin only: the agent's assisted share is far above the network's. */
export function AssistedAlertChip() {
  return (
    <span className="badge-gap">
      <StatusBadge tone="warning" label="High assisted share" />
    </span>
  );
}

const statusLabels: Record<CustomerStatus, [Tone, string]> = {
  pending_review: ["warning", "Pending review"],
  verified: ["success", "Verified"],
  rejected: ["error", "Rejected"],
};

export function StatusChip({ status }: { status: CustomerStatus }) {
  const [tone, label] = statusLabels[status];
  return <StatusBadge tone={tone} label={label} />;
}

const registrationLabels: Record<RegistrationStatus, [Tone, string]> = {
  received: ["neutral", "Received"],
  clear: ["success", "Clear"],
  under_review: ["warning", "Under review"],
  verified: ["success", "Verified"],
  rejected: ["error", "Rejected"],
};

/** Admin only: the registration pipeline status (it reveals the flag). */
export function RegistrationStatusChip({
  status,
}: {
  status: RegistrationStatus;
}) {
  const [tone, label] = registrationLabels[status];
  return <StatusBadge tone={tone} label={label} />;
}

const eligibilityLabels: Record<Eligibility, [Tone, string]> = {
  eligible: ["success", "Eligible"],
  pending: ["warning", "Pending"],
  not_eligible: ["error", "Not eligible"],
};

/** Admin only: commission eligibility of one registration. */
export function EligibilityChip({ value }: { value: Eligibility }) {
  const [tone, label] = eligibilityLabels[value];
  return <StatusBadge tone={tone} label={label} />;
}

/** What failed, then why and what to do when the cause is known. */
export function PageError({
  message,
  error,
}: {
  message: string;
  error?: unknown;
}) {
  const reason = apiErrorMessage(error, "Reload the page to try again.");
  return (
    <Alert severity="error">
      {message} {reason}
    </Alert>
  );
}
