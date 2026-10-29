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
  DataTable,
  KpiCard,
  PageError,
  PageHeader,
  type DataColumn,
} from "../../components/DataComponents";
import type { ClientEligibility, MonthQuality } from "../../types/scoring";

type AgentEligibility = ClientEligibility["agents"][number];

const eligibilityColumns: DataColumn<AgentEligibility>[] = [
  { key: "agent", label: "Agent", render: (row) => row.display_name },
  { key: "eligible", label: "Eligible", render: (row) => row.eligible },
  {
    key: "not_eligible",
    label: "Not eligible",
    render: (row) => row.not_eligible,
  },
];

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
          The export could not be downloaded. Please try again.
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
        <PageError message="Commission eligibility could not be loaded." />
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
      <DataTable
        columns={eligibilityColumns}
        rows={eligibility?.agents ?? []}
        // Display names are not unique; the list order is stable (by name).
        rowKey={(row, index) => `${index}-${row.display_name}`}
        loading={eligibilityQuery.isPending}
        emptyLabel="No agents work for you yet."
      />
    </section>
  );
}

const columns: DataColumn<MonthQuality>[] = [
  { key: "month", label: "Month", render: (row) => row.month },
  {
    key: "registrations",
    label: "Registrations",
    render: (row) => row.registrations,
  },
  {
    key: "fake",
    label: "Confirmed fake",
    render: (row) => row.confirmed_fake,
  },
  {
    key: "fake_percent",
    label: "Confirmed fake %",
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
        <CartesianGrid strokeDasharray="3 3" stroke="#e3e8e2" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="registrations" name="Registrations" fill="#1d5141" />
        <Line
          dataKey="confirmed_fake"
          name="Confirmed fake"
          stroke="#b63737"
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
        <PageError message="Registration quality could not be loaded." />
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
      <DataTable
        columns={columns}
        rows={quality?.trend ?? []}
        rowKey={(row) => row.month}
        loading={qualityQuery.isPending}
        emptyLabel="No registrations yet."
      />
      <EligibilitySection />
      <ExportSection />
    </>
  );
}
