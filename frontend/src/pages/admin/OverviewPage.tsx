import { Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import * as scoringApi from "../../api/scoring";
import {
  BandBadge,
  ChartCard,
  DataTable,
  EmptyState,
  KpiCard,
  PageError,
  PageHeader,
  type DataColumn,
} from "../../components/DataComponents";
import { KpiTable, MonthlyLineChart } from "../../components/KpiComponents";
import type { AgentRanking, BenchmarkRow } from "../../types/scoring";
import { formatRate } from "../../utils/format";

function formatDifference(value: number | null) {
  if (value === null) return "—";
  const points = (value * 100).toFixed(1);
  return value > 0 ? `+${points} pts` : `${points} pts`;
}

const benchmarkColumns: DataColumn<BenchmarkRow>[] = [
  {
    key: "agent",
    label: "Agent",
    render: (row) => (
      <Link to={`/admin/agents/${row.agent.id}`}>{row.agent.display_name}</Link>
    ),
  },
  {
    key: "registrations",
    label: "Registrations",
    render: (row) => row.registrations,
  },
  {
    key: "flag_rate",
    label: "Flag rate",
    render: (row) => formatRate(row.flag_rate),
  },
  {
    key: "difference",
    label: "Against network",
    render: (row) =>
      row.enough_data ? formatDifference(row.difference) : "Insufficient data",
  },
];

function NetworkSection() {
  const kpiQuery = useQuery({
    queryKey: ["admin", "kpis"],
    queryFn: scoringApi.getNetworkKpis,
  });
  const kpis = kpiQuery.data;
  const hasData = kpis?.months.some((month) => month.registrations > 0);
  return (
    <section aria-label="Network KPIs">
      {kpiQuery.isError && (
        <PageError message="Network KPIs could not be loaded." />
      )}
      <ChartCard
        title="Network flag rate"
        description="Share of each month's registrations flagged by the model or the rule, last 12 months."
      >
        {kpis &&
          (hasData ? (
            <MonthlyLineChart
              rows={kpis.months}
              value={(row) => row.flag_rate}
              name="Flag rate"
              format={(value) => formatRate(value, 0)}
            />
          ) : (
            <EmptyState
              title="No registrations yet"
              description="Network KPIs appear after the first registration."
            />
          ))}
      </ChartCard>
      <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>
        Network KPIs by month
      </Typography>
      <KpiTable
        rows={kpis?.months ?? []}
        loading={kpiQuery.isPending}
        label="No KPIs yet."
      />
      <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>
        Flag-rate benchmark
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1 }}>
        Each agent&apos;s flag rate over the last 12 months against the network
        rate ({formatRate(kpis?.network_flag_rate ?? null)}). Agents with fewer
        than {kpis?.min_registrations ?? "—"} registrations are not compared,
        because a few flags would swing their rate.
      </Typography>
      <DataTable
        columns={benchmarkColumns}
        rows={kpis?.benchmark ?? []}
        rowKey={(row) => row.agent.id}
        loading={kpiQuery.isPending}
        emptyLabel="No agents yet."
      />
    </section>
  );
}

const columns: DataColumn<AgentRanking>[] = [
  {
    key: "agent",
    label: "Agent",
    render: (row) => (
      <Link to={`/admin/agents/${row.id}`}>{row.display_name}</Link>
    ),
  },
  { key: "customers", label: "Customers", render: (row) => row.n_users },
  {
    key: "reputation",
    label: "Reputation",
    render: (row) => row.reputation.toFixed(1),
  },
  {
    key: "band",
    label: "Band",
    render: (row) => <BandBadge band={row.band} />,
  },
];

export function OverviewPage() {
  const modelQuery = useQuery({
    queryKey: ["admin", "model"],
    queryFn: scoringApi.getModel,
  });
  const queueQuery = useQuery({
    queryKey: ["admin", "review-queue", 0],
    queryFn: () => scoringApi.getReviewQueue(0, 25),
  });
  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: scoringApi.listAgents,
  });
  const agents = agentsQuery.data ?? [];
  // The ranking is already sorted by reputation, lowest first.
  const attention = agents
    .filter((agent) => agent.band !== "Low risk")
    .slice(0, 5);

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Overview"
        description="Model status, reviews waiting, and agents that need attention."
      />
      <section className="kpi-grid" aria-label="Workspace summary">
        <KpiCard
          label="Model"
          value={
            modelQuery.data
              ? modelQuery.data.status === "ok"
                ? "Ready"
                : "Failed"
              : null
          }
          detail={modelQuery.data?.model_version ?? undefined}
        />
        <KpiCard
          label="Reviews waiting"
          value={queueQuery.data?.total ?? null}
        />
        <KpiCard
          label="Agents"
          value={agentsQuery.data ? agents.length : null}
        />
        <KpiCard
          label="High-risk agents"
          value={
            agentsQuery.data
              ? agents.filter((agent) => agent.band === "High risk").length
              : null
          }
        />
      </section>
      <ChartCard
        title="Needs attention"
        description="The lowest-reputation agents that are not Low risk."
      >
        <DataTable
          columns={columns}
          rows={attention}
          rowKey={(row) => row.id}
          loading={agentsQuery.isPending}
          emptyLabel="No agents need attention."
        />
      </ChartCard>
      <NetworkSection />
    </>
  );
}
