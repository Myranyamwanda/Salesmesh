import { useState } from "react";
import {
  Alert,
  Button,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import * as adminApi from "../../api/admin";
import * as scoringApi from "../../api/scoring";
import {
  BandBadge,
  ChartCard,
  EmptyState,
  EligibilityChip,
  KpiCard,
  PageError,
  PageHeader,
  RegistrationStatusChip,
  StatusChip,
} from "../../components/DataComponents";
import { KpiTable, MonthlyLineChart } from "../../components/KpiComponents";
import { ReviewDialog } from "../../components/ReviewDialog";
import {
  DetailDrawer,
  DetailSection,
} from "../../components/table/DetailDrawer";
import { ListTable, type ListColumn } from "../../components/table/ListTable";
import { TableToolbar } from "../../components/table/TableToolbar";
import {
  pageOffset,
  useClampPage,
  useListParams,
} from "../../components/table/useListParams";
import type {
  AgentCustomer,
  AgentDetail,
  AgentMonthKpi,
} from "../../types/scoring";
import { apiErrorMessage } from "../../utils/errors";
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatPercent,
} from "../../utils/format";

const NO_CLIENT = "none";

const reputation = (row: AgentMonthKpi) =>
  row.reputation === null ? "—" : row.reputation.toFixed(1);

const reputationColumn: ListColumn<AgentMonthKpi> = {
  key: "reputation",
  label: "Reputation at month end",
  numeric: true,
  card: "stat",
  render: reputation,
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
      {kpiQuery.isError && (
        <PageError message="KPIs could not be loaded." error={kpiQuery.error} />
      )}
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
        extraDetails={(row) => [
          { label: "Reputation at month end", value: reputation(row) },
        ]}
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

const probability = (row: AgentCustomer) =>
  row.probability === null ? "—" : formatPercent(row.probability);

// Admin only: the registration status reveals the flag.
const customerColumns: ListColumn<AgentCustomer>[] = [
  {
    key: "customer",
    label: "Customer",
    card: "title",
    render: (row) => (
      <span className="cell-stack">
        <strong>{row.full_name}</strong>
        <span className="code-text">{row.reference}</span>
      </span>
    ),
  },
  {
    key: "date",
    label: "Registered",
    card: "stat",
    render: (row) => formatDate(row.created_at),
  },
  {
    key: "status",
    label: "Status",
    card: "badge",
    render: (row) => (
      <RegistrationStatusChip status={row.registration_status} />
    ),
  },
  {
    key: "eligibility",
    label: "Commission",
    card: "extra",
    render: (row) => <EligibilityChip value={row.eligibility} />,
  },
  {
    key: "probability",
    label: "Probability",
    numeric: true,
    card: "stat",
    render: probability,
  },
];

const listDefaults = { sort: "created_at", dir: "desc" } as const;

function CustomerDrawer({
  customer,
  onClose,
  onAssessment,
}: {
  customer: AgentCustomer | null;
  onClose: () => void;
  onAssessment: (assessmentId: string) => void;
}) {
  return (
    <DetailDrawer
      open={customer !== null}
      onClose={onClose}
      title={customer?.full_name ?? ""}
      subtitle={customer ? `Reference ${customer.reference}` : undefined}
      badge={
        customer && (
          <RegistrationStatusChip status={customer.registration_status} />
        )
      }
      actions={
        customer?.assessment_id && (
          <Button
            variant="contained"
            fullWidth
            onClick={() => onAssessment(customer.assessment_id!)}
          >
            Open assessment
          </Button>
        )
      }
    >
      {customer && (
        <>
          <DetailSection
            title="Registration"
            items={[
              {
                label: "Registered",
                value: formatDateTime(customer.created_at),
              },
              {
                label: "Customer status",
                value: <StatusChip status={customer.status} />,
              },
              {
                label: "Commission",
                value: <EligibilityChip value={customer.eligibility} />,
              },
              {
                label: "Registered on the agent's device",
                value: customer.assisted ? "Yes (assisted)" : "No",
              },
            ]}
          />
          <DetailSection
            title="Scoring"
            items={[
              {
                label: "Probability",
                value: probability(customer),
                numeric: true,
              },
              {
                label: "Flagged",
                value:
                  customer.flagged === null
                    ? "Not scored"
                    : customer.flagged
                      ? "Yes"
                      : "No",
              },
            ]}
          />
        </>
      )}
    </DetailDrawer>
  );
}

export function AgentDetailPage() {
  const { agentId = "" } = useParams();
  const { params, update, filtered, clearFilters } =
    useListParams(listDefaults);
  const [openCustomer, setOpenCustomer] = useState<AgentCustomer | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const agentQuery = useQuery({
    queryKey: ["admin", "agent", agentId, params.page, params.size, params.q],
    queryFn: () =>
      scoringApi.getAgent(
        agentId,
        pageOffset(params),
        params.size,
        params.q.trim(),
      ),
    placeholderData: keepPreviousData,
  });
  const agent = agentQuery.data;
  const total = agent?.customers_total;
  useClampPage(total, params, update);

  if (agentQuery.isError) {
    return (
      <PageError
        message="This agent could not be loaded."
        error={agentQuery.error}
      />
    );
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
            <KpiCard label="Customers" value={formatCount(agent.n_users)} />
            <KpiCard
              label="Flags"
              value={formatCount(agent.flags)}
              detail={`${agent.pending_review} pending · ${agent.confirmed_fake} confirmed fake`}
            />
            <KpiCard
              label="Assisted share"
              value={formatPercent(agent.assisted_share, 0)}
              detail={
                agent.assisted_alert
                  ? "High assisted share: far above the network's. Check this agent's assisted registrations."
                  : "Registered on the agent's own device"
              }
            />
          </section>
          <ProfileForm key={agent.id} agent={agent} />
          <AgentKpiSection agentId={agent.id} />
          <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>
            Customers
          </Typography>
        </>
      )}
      <ListTable
        label="Customers"
        columns={customerColumns}
        rows={agent?.customers ?? []}
        rowKey={(row) => row.id}
        onOpen={setOpenCustomer}
        openKey={openCustomer?.id}
        loading={agentQuery.isPending}
        total={total ?? 0}
        page={params.page}
        size={params.size}
        onPage={(page) => update({ page })}
        onSize={(size) => update({ size })}
        filtered={filtered}
        onClearFilters={clearFilters}
        emptyTitle="No customers yet"
        emptyDescription="Customers appear here when they register through this agent's link."
        toolbar={
          <TableToolbar
            search={params.q}
            searchLabel="Search name or reference"
            onSearch={(q) => update({ q })}
            count={
              total === undefined
                ? undefined
                : `${formatCount(total)} ${total === 1 ? "customer" : "customers"}${filtered ? " match" : ""}`
            }
          />
        }
      />
      <CustomerDrawer
        customer={openCustomer}
        onClose={() => setOpenCustomer(null)}
        onAssessment={(assessmentId) => {
          setOpenCustomer(null);
          setSelected(assessmentId);
        }}
      />
      <ReviewDialog assessmentId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
