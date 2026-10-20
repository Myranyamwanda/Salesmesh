import { useQuery } from "@tanstack/react-query";
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
import type { MonthQuality } from "../../types/scoring";

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
        description="Customers registered by the agents who work for you, over the last 12 months. Fake registrations are counted only after a SalesMesh reviewer has confirmed them."
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
    </>
  );
}
