import { Paper, Skeleton, Typography } from "@mui/material";
import FactCheck from "@mui/icons-material/FactCheck";
import Groups from "@mui/icons-material/Groups";
import PersonAddAlt1 from "@mui/icons-material/PersonAddAlt1";
import ReportProblem from "@mui/icons-material/ReportProblem";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import * as scoringApi from "../../api/scoring";
import { AgentReputationVisual } from "../../components/AgentReputationVisual";
import {
  AssistedAlertChip,
  BandBadge,
  ChartCard,
  EmptyState,
  PageError,
  PageHeader,
} from "../../components/DataComponents";
import { ListTable, type ListColumn } from "../../components/table/ListTable";
import { TableToolbar } from "../../components/table/TableToolbar";
import { pageRows, useListParams } from "../../components/table/useListParams";
import { KpiTable, MonthlyLineChart } from "../../components/KpiComponents";
import {
  InitialsAvatar,
  KpiTrendChart,
  TrendDelta,
} from "../../components/VisualIdentity";
import type {
  AgentRanking,
  BenchmarkRow,
  NetworkKpis,
} from "../../types/scoring";
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

function NetworkSection({
  kpiQuery,
}: {
  kpiQuery: UseQueryResult<NetworkKpis, Error>;
}) {
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
      <span className="identity-agent-cell">
        <InitialsAvatar name={row.display_name} seed={row.id} />
        <span className="cell-stack">
          <Link to={`/admin/agents/${row.id}`}>{row.display_name}</Link>
        </span>
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
    render: (row) => <AgentReputationVisual agent={row} />,
  },
  {
    key: "band",
    label: "Band",
    card: "badge",
    render: (row) => <BandBadge band={row.band} />,
  },
];

function bandRowClass(band: AgentRanking["band"]) {
  switch (band) {
    case "High risk":
      return "identity-band-high-risk";
    case "Watch":
      return "identity-band-watch";
    case "Low risk":
      return "identity-band-low-risk";
    case "Insufficient data":
      return "identity-band-insufficient";
  }
}

function OverviewMetricCard({
  tone,
  icon,
  label,
  value,
  loading,
  detail,
  trend,
}: {
  tone: "indigo" | "lime" | "cyan" | "violet";
  icon: ReactNode;
  label: string;
  value: number | null;
  loading: boolean;
  detail: string;
  trend?: {
    kind: "area" | "bar";
    months: string[];
    values: number[];
    name: string;
    current: number | null;
    previous: number | null;
  };
}) {
  const colours = chartTones[tone];
  return (
    <Paper
      className={`identity-kpi-card identity-kpi-${tone}`}
      variant="outlined"
    >
      <div className="identity-kpi-heading">
        <span className="identity-kpi-icon" aria-hidden="true">
          {icon}
        </span>
        <Typography component="h2" className="identity-kpi-label">
          {label}
        </Typography>
      </div>
      <div className="identity-kpi-value-row">
        {loading ? (
          <Skeleton
            className="identity-kpi-value-skeleton"
            variant="rounded"
            width={88}
            height={34}
          />
        ) : (
          <Typography className="identity-kpi-value">
            {value === null ? "—" : formatCount(value)}
          </Typography>
        )}
        {trend && (
          <TrendDelta
            current={trend.current}
            previous={trend.previous}
            label={trend.name}
          />
        )}
      </div>
      <Typography className="identity-kpi-detail">{detail}</Typography>
      {trend && (
        <KpiTrendChart
          kind={trend.kind}
          months={trend.months}
          values={trend.values}
          name={trend.name}
          {...colours}
        />
      )}
    </Paper>
  );
}

// Each KPI keeps its own solid colour; the numbers and text carry the
// meaning, the colour only tells the cards apart.
const chartTones = {
  indigo: { from: "#4f46e5", stroke: "#4f46e5" },
  lime: { from: "#84cc16", stroke: "#4d7c0f" },
  cyan: { from: "#22d3ee", stroke: "#0e7490" },
  violet: { from: "#a855f7", stroke: "#6d28d9" },
};

function AttentionSignals({
  kpiQuery,
  queueTotal,
  queueLoading,
  queueError,
}: {
  kpiQuery: UseQueryResult<NetworkKpis, Error>;
  queueTotal: number | undefined;
  queueLoading: boolean;
  queueError: boolean;
}) {
  const alerts =
    kpiQuery.data?.benchmark.filter((row) => row.assisted_alert).slice(0, 5) ??
    [];
  return (
    <aside
      className="identity-attention-signals"
      aria-label="Other attention signals"
    >
      <section className="identity-signal-card">
        <div className="identity-signal-heading">
          <FactCheck aria-hidden="true" />
          <h3>Pending reviews</h3>
        </div>
        <strong className="identity-signal-value">
          {queueLoading
            ? "Loading"
            : queueError
              ? "Unavailable"
              : formatCount(queueTotal ?? 0)}
        </strong>
        <Link to="/admin/review-queue">Open the review queue</Link>
      </section>
      <section className="identity-signal-card">
        <div className="identity-signal-heading">
          <ReportProblem aria-hidden="true" />
          <h3>High assisted share</h3>
        </div>
        {kpiQuery.isPending ? (
          <p>Loading signals…</p>
        ) : kpiQuery.isError ? (
          <p>Assisted-share signals could not be loaded.</p>
        ) : alerts.length ? (
          <ul className="identity-alert-list">
            {alerts.map((row) => (
              <li key={row.agent.id}>
                <Link to={`/admin/agents/${row.agent.id}`}>
                  {row.agent.display_name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>No agents currently meet the alert threshold.</p>
        )}
      </section>
    </aside>
  );
}

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
      scoringApi.listAgents({ offset: 0, limit: 5, band: ["High risk"] }),
  });
  const kpiQuery = useQuery({
    queryKey: ["admin", "kpis"],
    queryFn: scoringApi.getNetworkKpis,
  });
  const currentMonth = new Date().toISOString().slice(0, 7);
  const completedMonths =
    kpiQuery.data?.months
      .filter((month) => month.month < currentMonth)
      .slice(-6) ?? [];
  const previousMonth = completedMonths.at(-2);
  const latestMonth = completedMonths.at(-1);
  const summaryError =
    queueQuery.error ?? allQuery.error ?? highRiskQuery.error;
  const monthlyDetail = kpiQuery.isPending
    ? "Loading monthly data…"
    : kpiQuery.isError
      ? "Monthly data unavailable"
      : latestMonth
        ? `Completed month · ${latestMonth.month}`
        : "No completed monthly data";

  return (
    <div className="identity-overview">
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Overview"
        description="Reviews waiting and agents that need attention."
      />
      {summaryError && (
        <PageError
          message="Workspace summary could not be loaded."
          error={summaryError}
        />
      )}
      <section className="identity-kpi-grid" aria-label="Workspace summary">
        <OverviewMetricCard
          tone="indigo"
          icon={<PersonAddAlt1 />}
          label="Registrations"
          value={latestMonth?.registrations ?? null}
          loading={kpiQuery.isPending}
          detail={monthlyDetail}
          trend={
            kpiQuery.data
              ? {
                  kind: "area",
                  months: completedMonths.map((month) => month.month),
                  values: completedMonths.map((month) => month.registrations),
                  name: "Registrations",
                  current: latestMonth?.registrations ?? null,
                  previous: previousMonth?.registrations ?? null,
                }
              : undefined
          }
        />
        <OverviewMetricCard
          tone="lime"
          icon={<ReportProblem />}
          label="Confirmed fake"
          value={latestMonth?.confirmed_fake ?? null}
          loading={kpiQuery.isPending}
          detail={
            latestMonth && kpiQuery.data
              ? `Human-confirmed · ${latestMonth.month}`
              : monthlyDetail
          }
          trend={
            kpiQuery.data
              ? {
                  kind: "bar",
                  months: completedMonths.map((month) => month.month),
                  values: completedMonths.map((month) => month.confirmed_fake),
                  name: "Confirmed fake",
                  current: latestMonth?.confirmed_fake ?? null,
                  previous: previousMonth?.confirmed_fake ?? null,
                }
              : undefined
          }
        />
        <OverviewMetricCard
          tone="cyan"
          icon={<FactCheck />}
          label="Reviews waiting"
          value={queueQuery.data?.total ?? null}
          loading={queueQuery.isPending}
          detail={
            queueQuery.isError
              ? "Review count unavailable"
              : queueQuery.isPending
                ? "Loading review count…"
                : "Require an admin decision"
          }
        />
        <OverviewMetricCard
          tone="violet"
          icon={<Groups />}
          label="Agents"
          value={allQuery.data?.total ?? null}
          loading={allQuery.isPending}
          detail={
            allQuery.isError
              ? "Agent count unavailable"
              : allQuery.isPending
                ? "Loading agent count…"
                : "Across the network"
          }
        />
      </section>
      <section className="identity-attention" aria-labelledby="needs-attention">
        <header className="identity-attention-heading">
          <div>
            <p className="identity-attention-eyebrow">LIVE SIGNALS</p>
            <Typography component="h2" id="needs-attention">
              Needs attention
            </Typography>
            <p>
              Review agent standings, open reviews, and assisted-share alerts.
            </p>
          </div>
          <Link to="/admin/review-queue">Go to review queue</Link>
        </header>
        <div className="identity-attention-grid">
          <section aria-label="High-risk agents">
            <h3 className="identity-attention-subtitle">
              High-risk agents
              <span>
                {highRiskQuery.data
                  ? formatCount(highRiskQuery.data.total)
                  : highRiskQuery.isError
                    ? "Unavailable"
                    : "Loading"}
              </span>
            </h3>
            <ListTable
              label="High-risk agents"
              columns={columns}
              rows={highRiskQuery.data?.items ?? []}
              rowKey={(row) => row.id}
              rowClassName={(row) => bandRowClass(row.band)}
              loading={highRiskQuery.isPending}
              emptyTitle="No high-risk agents"
              emptyDescription="No agents currently fall in the High risk band."
            />
          </section>
          <AttentionSignals
            kpiQuery={kpiQuery}
            queueTotal={queueQuery.data?.total}
            queueLoading={queueQuery.isPending}
            queueError={queueQuery.isError}
          />
        </div>
      </section>
      <NetworkSection kpiQuery={kpiQuery} />
    </div>
  );
}
