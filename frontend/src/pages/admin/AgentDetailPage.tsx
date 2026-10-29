import { useState } from "react";
import {
  Alert,
  Button,
  MenuItem,
  Paper,
  Stack,
  TablePagination,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import * as adminApi from "../../api/admin";
import * as scoringApi from "../../api/scoring";
import {
  BandBadge,
  ChartCard,
  DataTable,
  EmptyState,
  EligibilityChip,
  KpiCard,
  PageError,
  PageHeader,
  RegistrationStatusChip,
  type DataColumn,
} from "../../components/DataComponents";
import { KpiTable, MonthlyLineChart } from "../../components/KpiComponents";
import { ReviewDialog } from "../../components/ReviewDialog";
import type {
  AgentCustomer,
  AgentDetail,
  AgentMonthKpi,
} from "../../types/scoring";
import { apiErrorMessage } from "../../utils/errors";
import { formatDate, formatPercent } from "../../utils/format";

const PAGE_SIZE = 25;
const NO_CLIENT = "none";

const reputationColumn: DataColumn<AgentMonthKpi> = {
  key: "reputation",
  label: "Reputation at month end",
  render: (row) => (row.reputation === null ? "—" : row.reputation.toFixed(1)),
};

function AgentKpiSection({ agentId }: { agentId: string }) {
  const kpiQuery = useQuery({
    queryKey: ["admin", "agent-kpis", agentId],
    queryFn: () => scoringApi.getAgentKpis(agentId),
  });
  const months = kpiQuery.data?.months ?? [];
  const hasData = months.some((month) => month.reputation !== null);
  return (
    <section aria-label="Monthly KPIs">
      {kpiQuery.isError && <PageError message="KPIs could not be loaded." />}
      <ChartCard
        title="Reputation at month end"
        description="Last 12 months. Each point uses only the registrations and reviews known at the end of that month; the current month is as of now."
      >
        {kpiQuery.data &&
          (hasData ? (
            <MonthlyLineChart
              rows={months}
              value={(row) => row.reputation}
              name="Reputation"
              format={(value) => value.toFixed(1)}
            />
          ) : (
            <EmptyState
              title="No registrations yet"
              description="The trend starts with the agent's first registration."
            />
          ))}
      </ChartCard>
      <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>
        Monthly KPIs
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1 }}>
        Each month counts the registrations made in it and what has happened to
        them so far. Verification rate is confirmed real out of reviewed; a dash
        means there was nothing to measure.
      </Typography>
      <KpiTable
        rows={months}
        extra={[reputationColumn]}
        loading={kpiQuery.isPending}
        label="No KPIs yet."
      />
    </section>
  );
}

function ProfileForm({ agent }: { agent: AgentDetail }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(agent.display_name);
  const [clientId, setClientId] = useState(agent.client?.id ?? NO_CLIENT);
  const [notice, setNotice] = useState("");
  const clientsQuery = useQuery({
    queryKey: ["admin", "clients"],
    queryFn: adminApi.listClients,
  });
  const saveMutation = useMutation({
    mutationFn: () =>
      scoringApi.updateAgent(agent.id, {
        display_name: displayName,
        client_id: clientId === NO_CLIENT ? null : clientId,
      }),
    onSuccess: () => {
      setNotice("Agent profile saved.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "agent"] });
    },
  });

  return (
    <Paper className="chart-card" variant="outlined" square>
      <Typography component="h2" variant="h6" gutterBottom>
        Profile
      </Typography>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          setNotice("");
          saveMutation.mutate();
        }}
      >
        <TextField
          label="Display name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          helperText="Shown to customers on the agent's registration link"
          slotProps={{ htmlInput: { maxLength: 100 } }}
        />
        <TextField
          select
          label="Client"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          helperText="The client this agent works for. Customers see its organisation name on the registration link, and the client sees only their agents' registration quality."
        >
          <MenuItem value={NO_CLIENT}>No client</MenuItem>
          {(clientsQuery.data ?? []).map((client) => (
            <MenuItem key={client.id} value={client.id}>
              {adminApi.clientLabel(client)}
            </MenuItem>
          ))}
          {agent.client &&
            !clientsQuery.data?.some(
              (client) => client.id === agent.client?.id,
            ) && (
              <MenuItem value={agent.client.id}>
                {adminApi.clientLabel(agent.client)}
              </MenuItem>
            )}
        </TextField>
        {saveMutation.isError && (
          <Alert severity="error">
            {apiErrorMessage(saveMutation.error, "The profile was not saved.")}
          </Alert>
        )}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Button
          type="submit"
          variant="contained"
          disabled={saveMutation.isPending || displayName.trim().length < 2}
          sx={{ alignSelf: "flex-start" }}
        >
          Save profile
        </Button>
      </Stack>
    </Paper>
  );
}

export function AgentDetailPage() {
  const { agentId = "" } = useParams();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const agentQuery = useQuery({
    queryKey: ["admin", "agent", agentId, page],
    queryFn: () => scoringApi.getAgent(agentId, page * PAGE_SIZE, PAGE_SIZE),
  });
  const agent = agentQuery.data;

  const columns: DataColumn<AgentCustomer>[] = [
    { key: "reference", label: "Reference", render: (row) => row.reference },
    { key: "name", label: "Customer", render: (row) => row.full_name },
    {
      key: "date",
      label: "Registered",
      render: (row) => formatDate(row.created_at),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <RegistrationStatusChip status={row.registration_status} />
      ),
    },
    {
      key: "eligibility",
      label: "Commission",
      render: (row) => <EligibilityChip value={row.eligibility} />,
    },
    {
      key: "probability",
      label: "Probability",
      render: (row) =>
        row.probability === null ? "—" : formatPercent(row.probability),
    },
    {
      key: "flagged",
      label: "Flagged",
      render: (row) => (row.flagged ? "Yes" : "No"),
    },
    {
      key: "assisted",
      label: "Assisted",
      render: (row) => (row.assisted ? "Yes" : "No"),
    },
    {
      key: "action",
      label: "",
      render: (row) =>
        row.assessment_id && (
          <Button size="small" onClick={() => setSelected(row.assessment_id)}>
            Open
          </Button>
        ),
    },
  ];

  if (agentQuery.isError) {
    return <PageError message="This agent could not be loaded." />;
  }
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION / AGENT"
        title={agent?.display_name ?? "Agent"}
        description={
          agent
            ? `${agent.email} · code ${agent.referral_code} · account ${agent.is_active ? agent.status : "deactivated"}`
            : undefined
        }
        action={agent && <BandBadge band={agent.band} />}
      />
      {agent && (
        <>
          {!agent.link_active && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Registration link not active. Customers can register only when the
              agent is approved, active, and email-verified and works for an
              active client that has an organisation name.
            </Alert>
          )}
          <section className="kpi-grid" aria-label="Agent reputation">
            <KpiCard
              label="Reputation"
              value={agent.reputation.toFixed(1)}
              detail="0–100, higher is better"
            />
            <KpiCard label="Risk score" value={agent.risk_score.toFixed(1)} />
            <KpiCard label="Customers" value={agent.n_users} />
            <KpiCard
              label="Flags"
              value={agent.flags}
              detail={`${agent.pending_review} pending · ${agent.confirmed_fake} confirmed fake`}
            />
            <KpiCard
              label="Assisted share"
              value={formatPercent(agent.assisted_share, 0)}
              detail="Registered on the agent's own device"
            />
          </section>
          <ProfileForm key={agent.id} agent={agent} />
          <AgentKpiSection agentId={agent.id} />
          <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>
            Customers
          </Typography>
        </>
      )}
      <DataTable
        columns={columns}
        rows={agent?.customers ?? []}
        rowKey={(row) => row.id}
        loading={agentQuery.isPending}
        emptyLabel="This agent has no customers yet."
      />
      <TablePagination
        component="div"
        count={agent?.customers_total ?? 0}
        page={page}
        onPageChange={(_, next) => setPage(next)}
        rowsPerPage={PAGE_SIZE}
        rowsPerPageOptions={[PAGE_SIZE]}
      />
      <ReviewDialog assessmentId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
