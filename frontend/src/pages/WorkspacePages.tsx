import { Button, Link as MuiLink, Stack, Typography } from "@mui/material";
import ArrowForward from "@mui/icons-material/ArrowForward";
import { Link } from "react-router-dom";
import {
  ChartCard,
  EmptyState,
  KpiCard,
  PageHeader,
} from "../components/DataComponents";
import { useAuth } from "../hooks/useAuth";

export function AdminOverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Overview"
        description="A workspace summary will appear as approved data sources are connected."
      />
      <section className="kpi-grid" aria-label="Workspace data status">
        <KpiCard
          label="Scoring model"
          value="Not connected"
          detail="No model is active"
        />
        <KpiCard
          label="Agent data"
          value="Not available"
          detail="Dataset not selected"
        />
        <KpiCard
          label="Reports"
          value="Not available"
          detail="No source data yet"
        />
      </section>
      <section className="dashboard-grid">
        <ChartCard
          title="Scoring activity"
          description="Risk and reputation activity will appear when the scoring model is connected."
        />
        <ChartCard
          title="Recent review activity"
          description="Dataset-dependent review data is not available yet."
        />
      </section>
      <EmptyState
        title="Scoring is not connected"
        description="No data yet - the scoring model is not connected."
      />
    </>
  );
}

export function AgentsListPage() {
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Agents"
        description="Agent records depend on the dataset and approved domain model."
      />
      <EmptyState
        title="Agent records are not available"
        description="No data yet - agent data will appear after the dataset and model are approved."
      />
    </>
  );
}

export function AgentDetailPage() {
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION / AGENT"
        title="Agent detail"
        description="Agent details are unavailable until the domain data model is approved."
      />
      <EmptyState
        title="No agent detail yet"
        description="This page will use the selected dataset; no agent fields have been defined."
      />
    </>
  );
}

export function ReviewQueuePage() {
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Review queue"
        description="Flagged-agent review requires connected scoring data."
      />
      <EmptyState
        title="Nothing to review yet"
        description="No data yet - flagged records will appear when the scoring model is connected."
      />
    </>
  );
}

export function ModelManagementPage() {
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Model management"
        description="Model controls will be enabled after the scoring interface and model artifact are connected."
      />
      <EmptyState
        title="No scoring model connected"
        description="Model versions, thresholds, and metrics are not available yet."
      />
    </>
  );
}

export function SystemSettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="System settings"
        description="Operational settings will be added when their management API is approved."
      />
      <EmptyState
        title="No settings controls yet"
        description="No additional system settings are exposed in this phase."
      />
    </>
  );
}

export function AgentDashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="AGENT WORKSPACE"
        title="My dashboard"
        description="Your workspace will summarize approved onboarding and scoring data."
      />
      <section className="kpi-grid" aria-label="Agent workspace data status">
        <KpiCard
          label="Reputation"
          value="Not available"
          detail="Scoring model not connected"
        />
        <KpiCard
          label="Performance"
          value="Not available"
          detail="Dataset not selected"
        />
        <KpiCard
          label="Onboarding"
          value="Not available"
          detail="No onboarding data yet"
        />
      </section>
      <ChartCard
        title="Performance overview"
        description="No performance fields are defined until the dataset is approved."
      />
      <EmptyState title="Your data is not connected" />
    </>
  );
}

export function AgentTasksPage() {
  return (
    <>
      <PageHeader
        eyebrow="AGENT WORKSPACE"
        title="My onboarding tasks"
        description="Tasks will appear when the onboarding workflow and its data model are connected."
      />
      <EmptyState
        title="No onboarding tasks yet"
        description="No data yet - your onboarding workspace is not connected."
      />
    </>
  );
}

export function ClientDashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="CLIENT WORKSPACE"
        title="Client dashboard"
        description="Onboarding summaries will appear when approved client data is connected."
      />
      <section className="kpi-grid" aria-label="Client workspace data status">
        <KpiCard
          label="Onboarding"
          value="Not available"
          detail="Dataset not selected"
        />
        <KpiCard
          label="Reports"
          value="Not available"
          detail="No source data yet"
        />
        <KpiCard
          label="Scoring"
          value="Not connected"
          detail="Model not active"
        />
      </section>
      <ChartCard
        title="Onboarding overview"
        description="No client or onboarding data fields are defined yet."
      />
      <EmptyState title="No client data yet" />
    </>
  );
}

export function ClientReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="CLIENT WORKSPACE"
        title="Onboarding reports"
        description="Reports will be built from the selected dataset after its fields are approved."
      />
      <EmptyState
        title="No reports yet"
        description="No data yet - onboarding reports are not connected."
      />
    </>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader
        eyebrow="ACCOUNT"
        title="My profile"
        description="Authentication profile details."
      />
      <section className="profile-summary" aria-label="Profile details">
        <div>
          <Typography className="profile-label">Email</Typography>
          <Typography>{user?.email}</Typography>
        </div>
        <div>
          <Typography className="profile-label">Role</Typography>
          <Typography sx={{ textTransform: "capitalize" }}>
            {user?.role}
          </Typography>
        </div>
        <div>
          <Typography className="profile-label">Account status</Typography>
          <Typography sx={{ textTransform: "capitalize" }}>
            {user?.status}
          </Typography>
        </div>
        <div>
          <Typography className="profile-label">Email verification</Typography>
          <Typography>
            {user?.email_verified_at ? "Verified" : "Not verified"}
          </Typography>
        </div>
        <div>
          <Typography className="profile-label">Account created</Typography>
          <Typography>
            {user?.created_at
              ? new Date(user.created_at).toLocaleDateString()
              : "—"}
          </Typography>
        </div>
      </section>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <Button
          component={Link}
          to="/change-password"
          variant="contained"
          endIcon={<ArrowForward />}
        >
          Change password
        </Button>
        <MuiLink component={Link} to="/">
          Return to workspace
        </MuiLink>
      </Stack>
    </>
  );
}
