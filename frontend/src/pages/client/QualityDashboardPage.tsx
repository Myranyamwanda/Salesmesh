import { Alert, Button, Typography } from "@mui/material";
import FileDownloadOutlined from "@mui/icons-material/FileDownloadOutlined";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import * as portalApi from "../../api/portal";
import {
  ChartCard,
  KpiCard,
  PageError,
  PageHeader,
} from "../../components/DataComponents";
import { ListTable, type ListColumn } from "../../components/table/ListTable";
import { TableToolbar } from "../../components/table/TableToolbar";
import { pageRows, useListParams } from "../../components/table/useListParams";
import { formatCount } from "../../utils/format";
import { chart } from "../../tokens";
import type { ClientEligibility, MonthQuality } from "../../types/scoring";
import { apiErrorMessage } from "../../utils/errors";

type AgentEligibility = ClientEligibility["agents"][number];

// Clients see names and two counts only, so rows open no details.
const eligibilityColumns: ListColumn<AgentEligibility>[] = [
  {
    key: "agent",
    label: "Agent",
    card: "title",
    sortable: true,
    render: (row) => (
      <span className="cell-stack">
        <strong>{row.display_name}</strong>
      </span>
    ),
  },
  {
    key: "eligible",
    label: "Eligible",
    numeric: true,
    sortable: true,
    card: "stat",
    render: (row) => formatCount(row.eligible),
  },
  {
    key: "not_eligible",
    label: "Not eligible",
    numeric: true,
    sortable: true,
    card: "stat",
    render: (row) => formatCount(row.not_eligible),
  },
];

const agentListDefaults = { sort: "agent", dir: "asc" } as const;

const agentSortValue = (row: AgentEligibility, key: string) =>
  key === "eligible"
    ? row.eligible
    : key === "not_eligible"
      ? row.not_eligible
      : row.display_name.toLowerCase();

function ExportSection() {
  const exportMutation = useMutation({
    mutationFn: portalApi.downloadCustomerExport,
  });
  return (
    <section aria-label="Export verified customers">
      <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>
        Export verified customers
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        A CSV file of the customers registered for you that passed the checks or
        were verified by a reviewer: reference, name, email, mobile phone, and
        registration date. Registrations awaiting verification are added once a
        reviewer has decided, and customers who registered before the consent
        text named you are never included. Every download is recorded in the
        audit log.
      </Typography>
      {exportMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          The export could not be downloaded.{" "}
          {apiErrorMessage(exportMutation.error, "Try again.")}
        </Alert>
      )}
      {exportMutation.isSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Downloaded {exportMutation.data}.
        </Alert>
      )}
      <Button
        variant="contained"
        startIcon={<FileDownloadOutlined />}
        onClick={() => exportMutation.mutate()}
        disabled={exportMutation.isPending}
      >
        {exportMutation.isPending ? "Preparing…" : "Download CSV"}
      </Button>
    </section>
  );
}

function EligibilitySection() {
  const eligibilityQuery = useQuery({
    queryKey: ["client", "eligibility"],
    queryFn: portalApi.getClientEligibility,
  });
  const eligibility = eligibilityQuery.data;
  const { params, update, filtered, clearFilters } =
    useListParams(agentListDefaults);
  // The API sends this client's few agents in full; page them here.
  const page = pageRows(eligibility?.agents ?? [], params, {
    matches: (row, term) => row.display_name.toLowerCase().includes(term),
    sortValue: agentSortValue,
  });
  return (
    <section aria-label="Commission eligibility">
      <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>
        Commission eligibility
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Registrations made for you since the start. Eligible registrations
        passed the checks or were verified by a reviewer; not eligible ones were
        confirmed as fake. Registrations awaiting verification are shown only as
        a total, so no agent is judged before a reviewer has decided.
      </Typography>
      {eligibilityQuery.isError && (
        <PageError
          message="Commission eligibility could not be loaded."
          error={eligibilityQuery.error}
        />
      )}
      <div className="kpi-grid">
        <KpiCard label="Eligible" value={eligibility?.eligible ?? null} />
        <KpiCard
          label="Awaiting verification"
          value={eligibility?.pending ?? null}
          detail="Total for all your agents"
        />
        <KpiCard
          label="Not eligible"
          value={eligibility?.not_eligible ?? null}
        />
      </div>
      <ListTable
        label="Eligibility by agent"
        columns={eligibilityColumns}
        rows={page.rows}
        // Display names are not unique; add the counts to tell rows apart.
        rowKey={(row) =>
          `${row.display_name}-${row.eligible}-${row.not_eligible}-${page.rows.indexOf(row)}`
        }
        loading={eligibilityQuery.isPending}
        total={page.total}
        page={page.page}
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
        onPage={(next) => update({ page: next })}
        onSize={(size) => update({ size })}
        filtered={filtered}
        onClearFilters={clearFilters}
        emptyTitle="No agents work for you yet"
        toolbar={
          <TableToolbar
            search={params.q}
            searchLabel="Search agents"
            onSearch={(q) => update({ q })}
            count={
              eligibility
                ? `${formatCount(page.total)} ${page.total === 1 ? "agent" : "agents"}${filtered ? " match" : ""}`
                : undefined
            }
          />
        }
      />
    </section>
  );
}

// Twelve fixed months: a report, so no search, pager, or details.
const columns: ListColumn<MonthQuality>[] = [
  { key: "month", label: "Month", card: "title", render: (row) => row.month },
  {
    key: "registrations",
    label: "Registrations",
    numeric: true,
    card: "stat",
    render: (row) => formatCount(row.registrations),
  },
  {
    key: "fake",
    label: "Confirmed fake",
    numeric: true,
    card: "stat",
    render: (row) => formatCount(row.confirmed_fake),
  },
  {
    key: "fake_percent",
    label: "Confirmed fake %",
    numeric: true,
    card: "stat",
    // A dash for a month without registrations, never a misleading 0%.
    render: (row) =>
      row.confirmed_fake_percent === null
        ? "—"
        : `${row.confirmed_fake_percent}%`,
  },
];

export function QualityChart({
  trend,
  height = 300,
}: {
  trend: MonthQuality[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={trend} margin={{ top: 8, right: 16, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="registrations" name="Registrations" fill={chart.series} />
        <Line
          dataKey="confirmed_fake"
          name="Confirmed fake"
          stroke={chart.comparison}
          strokeWidth={2}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function QualityDashboardPage() {
  const qualityQuery = useQuery({
    queryKey: ["client", "quality"],
    queryFn: portalApi.getQuality,
  });
  const quality = qualityQuery.data;
  return (
    <>
      <PageHeader
        eyebrow="CLIENT WORKSPACE"
        title="Registration quality"
        description="Customers registered for you by your agents, with a 12-month trend. Fake registrations are counted only after a SalesMesh reviewer has confirmed them."
      />
      {qualityQuery.isError && (
        <PageError
          message="Registration quality could not be loaded."
          error={qualityQuery.error}
        />
      )}
      <section className="kpi-grid" aria-label="Registration quality">
        <KpiCard label="Registrations" value={quality?.registrations ?? null} />
        <KpiCard
          label="Confirmed fake"
          value={quality ? `${quality.confirmed_fake_percent}%` : null}
          detail={
            quality ? `${quality.confirmed_fake} registrations` : undefined
          }
        />
        <KpiCard
          label="Under review"
          value={quality?.under_review ?? null}
          detail="Registrations a reviewer is still checking"
        />
      </section>
      <ChartCard
        title="Monthly trend"
        description="Registrations (bars) and registrations confirmed as fake (line)."
      >
        {quality && <QualityChart trend={quality.trend} />}
      </ChartCard>
      <ListTable
        label="Monthly trend"
        columns={columns}
        // Newest month first for reading; the chart runs oldest to newest.
        rows={[...(quality?.trend ?? [])].reverse()}
        rowKey={(row) => row.month}
        loading={qualityQuery.isPending}
        emptyTitle="No registrations yet"
      />
      <EligibilitySection />
      <ExportSection />
    </>
  );
}
