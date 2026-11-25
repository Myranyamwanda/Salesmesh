import { Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import * as scoringApi from "../api/scoring";
import type { MonitoringMonth } from "../types/scoring";
import { chart } from "../tokens";
import { formatCount, formatPercent } from "../utils/format";
import { ChartCard, PageError } from "./DataComponents";
import { ListTable, type ListColumn } from "./table/ListTable";

const percentOrDash = (value: number | null) =>
  value === null ? "—" : formatPercent(value, 2);

// Twelve fixed months: a report, so no search, pager, or details.
const columns: ListColumn<MonitoringMonth>[] = [
  { key: "month", label: "Month", card: "title", render: (row) => row.month },
  {
    key: "count",
    label: "Assessments",
    numeric: true,
    card: "stat",
    render: (row) => formatCount(row.assessments),
  },
  {
    key: "rate",
    label: "Model flag rate",
    numeric: true,
    card: "stat",
    render: (row) => percentOrDash(row.flag_rate),
  },
  {
    key: "mean",
    label: "Mean probability",
    numeric: true,
    card: "stat",
    render: (row) => percentOrDash(row.mean_probability),
  },
];

/** Monthly model flag rate and mean probability, compared with p0. */
export function MonitoringCard() {
  const monitoringQuery = useQuery({
    queryKey: ["admin", "model", "monitoring"],
    queryFn: scoringApi.getMonitoring,
  });
  const monitoring = monitoringQuery.data;
  // Recharts plots percentages; months without assessments stay as gaps.
  const points = (monitoring?.months ?? []).map((month) => ({
    month: month.month,
    flagRate: month.flag_rate === null ? null : month.flag_rate * 100,
    meanProbability:
      month.mean_probability === null ? null : month.mean_probability * 100,
  }));

  return (
    <ChartCard
      title="Monitoring"
      description="Monthly share of registrations the model flagged, and the mean probability, over the last 12 months."
    >
      {monitoringQuery.isError && (
        <PageError
          message="Monitoring data could not be loaded."
          error={monitoringQuery.error}
        />
      )}
      {monitoring && (
        <>
          <Typography color="text.secondary" sx={{ mb: 1 }}>
            Expected flag rate (p0): {formatPercent(monitoring.p0, 2)}. A
            sustained difference from p0 can indicate drift; recalibrate the
            threshold or p0 with reviewed cases.
          </Typography>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={points} margin={{ top: 8, right: 16, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis unit="%" tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
              <Legend />
              <ReferenceLine
                y={monitoring.p0 * 100}
                stroke={chart.reference}
                strokeDasharray="6 4"
                label={{ value: "p0", position: "insideTopRight" }}
              />
              <Line
                dataKey="flagRate"
                name="Model flag rate"
                stroke={chart.comparison}
                strokeWidth={2}
                connectNulls={false}
              />
              <Line
                dataKey="meanProbability"
                name="Mean probability"
                stroke={chart.series}
                strokeWidth={2}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
      <ListTable
        label="Monthly model monitoring"
        columns={columns}
        rows={monitoring?.months ?? []}
        rowKey={(row) => row.month}
        loading={monitoringQuery.isPending}
        emptyTitle="No assessments yet"
      />
    </ChartCard>
  );
}
