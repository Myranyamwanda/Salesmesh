import { Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import * as scoringApi from "../../api/scoring";
import {
  AssistedAlertChip,
  BandBadge,
  ChartCard,
  EmptyState,
  KpiCard,
  PageError,
  PageHeader,
} from "../../components/DataComponents";
import { ListTable, type ListColumn } from "../../components/table/ListTable";
import { TableToolbar } from "../../components/table/TableToolbar";
import { pageRows, useListParams } from "../../components/table/useListParams";
import { KpiTable, MonthlyLineChart } from "../../components/KpiComponents";
import type { AgentRanking, BenchmarkRow } from "../../types/scoring";
import { formatCount, formatRate } from "../../utils/format";

function formatDifference(value: number | null) {
  if (value === null) return "—";
  const points = (value * 100).toFixed(1);
  return value > 0 ? `+${points} pts` : `${points} pts`;
}

// Links, not a drawer: the agent detail page holds everything else.
const benchmarkColumns: ListColumn<BenchmarkRow>[] = [
  {
    key: "agent",
    label: "Agent",
    card: "title",
    sortable: true,
    render: (row) => (
      <span className="cell-stack">
        <Link to={`/admin/agents/${row.agent.id}`}>
          {row.agent.display_name}
        </Link>
      </span>
    ),
  },
  {
    key: "registrations",
    label: "Registrations",
    numeric: true,
    sortable: true,
    card: "stat",
    render: (row) => formatCount(row.registrations),
  },
  {
    key: "flag_rate",
    label: "Flag rate",
    numeric: true,
    sortable: true,
    card: "stat",
    render: (row) => formatRate(row.flag_rate),
  },
  {
    key: "difference",
    label: "Against network",
    numeric: true,
    sortable: true,
    card: "stat",
    render: (row) =>
      row.enough_data ? formatDifference(row.difference) : "Insufficient data",
  },
  {
    key: "signals",
    label: "Signals",
    card: "extra",
    render: (row) =>
      row.assisted_alert ? (
        <AssistedAlertChip />
      ) : (
        <span className="muted-dash">
          <span aria-hidden="true">—</span>
          <span className="visually-hidden">None</span>
        </span>
      ),
  },
];

// Largest difference first: the agents furthest above the network rate.
const benchmarkDefaults = {
  sort: "difference",
  dir: "desc",
  prefix: "bench_",
} as const;

function benchmarkValue(row: BenchmarkRow, key: string) {
  if (key === "agent") return row.agent.display_name.toLowerCase();
  if (key === "registrations") return row.registrations;
  if (key === "flag_rate") return row.flag_rate;
  return row.enough_data ? row.difference : null;
}

function NetworkSection() {
  const kpiQuery = useQuery({
    queryKey: ["admin", "kpis"],
    queryFn: scoringApi.getNetworkKpis,
  });
  const kpis = kpiQuery.data;
  const hasData = kpis?.months.some((month) => month.registrations > 0);
  const { params, update, filtered, clearFilters } =
    useListParams(benchmarkDefaults);
  // One row per agent from /admin/kpis; searched, sorted, and paged here.
  const benchmark = pageRows(kpis?.benchmark ?? [], params, {
    matches: (row, term) => row.agent.display_name.toLowerCase().includes(term),
    sortValue: benchmarkValue,
  });
  return (
    <section aria-label="Network KPIs">
      {kpiQuery.isError && (
        <PageError
          message="Network KPIs could not be loaded."
          error={kpiQuery.error}
        />
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
      <ListTable
        label="Flag-rate benchmark"
        columns={benchmarkColumns}
        rows={benchmark.rows}
        rowKey={(row) => row.agent.id}
        loading={kpiQuery.isPending}
        total={benchmark.total}
        page={benchmark.page}
        size={params.size}
        sort={params.sort}
        dir={params.dir}
        onSort={(key) =>
          update(
            key === params.sort
              ? { dir: params.dir === "asc" ? "desc" : "asc" }
              : { sort: key, dir: key === "agent" ? "asc" : "desc" },
          )
        }
        onPage={(page) => update({ page })}
        onSize={(size) => update({ size })}
        filtered={filtered}
        onClearFilters={clearFilters}
        emptyTitle="No agents yet"
        toolbar={
          <TableToolbar
            search={params.q}
            searchLabel="Search agents"
            onSearch={(q) => update({ q })}
            count={
              kpis
                ? `${formatCount(benchmark.total)} ${benchmark.total === 1 ? "agent" : "agents"}${filtered ? " match" : ""}`
                : undefined
            }
          />
        }
      />
    </section>
  );
}

// At most five rows: a summary, so no toolbar or pager.
const columns: ListColumn<AgentRanking>[] = [
  {
    key: "agent",
    label: "Agent",
    card: "title",
    render: (row) => (
      <span className="cell-stack">
        <Link to={`/admin/agents/${row.id}`}>{row.display_name}</Link>
      </span>
    ),
  },
  {
    key: "customers",
    label: "Customers",
    numeric: true,
    card: "stat",
    render: (row) => formatCount(row.n_users),
  },
  {
    key: "reputation",
    label: "Reputation",
    numeric: true,
    card: "stat",
    render: (row) => row.reputation.toFixed(1),
  },
  {
    key: "band",
    label: "Band",
    card: "badge",
    render: (row) => <BandBadge band={row.band} />,
  },
];

export function OverviewPage() {
  const queueQuery = useQuery({
    queryKey: ["admin", "review-queue", 0],
    queryFn: () => scoringApi.getReviewQueue({ offset: 0, limit: 1 }),
  });
  // Three small counted requests instead of loading every agent: the
  // agents list is paged on the server (lowest reputation first).
  const allQuery = useQuery({
    queryKey: ["admin", "agents", "count"],
    queryFn: () => scoringApi.listAgents({ offset: 0, limit: 1 }),
  });
  const highRiskQuery = useQuery({
    queryKey: ["admin", "agents", "count", "High risk"],
    queryFn: () =>
      scoringApi.listAgents({ offset: 0, limit: 1, band: ["High risk"] }),
  });
  const attentionQuery = useQuery({
    queryKey: ["admin", "agents", "attention"],
    queryFn: () =>
      scoringApi.listAgents({
        offset: 0,
        limit: 5,
        band: ["High risk", "Watch", "Insufficient data"],
      }),
  });

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Overview"
        description="Reviews waiting and agents that need attention."
      />
      <section className="kpi-grid" aria-label="Workspace summary">
        <KpiCard
          label="Reviews waiting"
          value={queueQuery.data?.total ?? null}
        />
        <KpiCard label="Agents" value={allQuery.data?.total ?? null} />
        <KpiCard
          label="High-risk agents"
          value={highRiskQuery.data?.total ?? null}
        />
      </section>
      <ChartCard
        title="Needs attention"
        description="The lowest-reputation agents that are not Low risk."
      >
        <ListTable
          label="Agents that need attention"
          columns={columns}
          rows={attentionQuery.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={attentionQuery.isPending}
          emptyTitle="No agents need attention"
        />
      </ChartCard>
      <NetworkSection />
    </>
  );
}
