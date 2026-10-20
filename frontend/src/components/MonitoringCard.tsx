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
import { formatPercent } from "../utils/format";
import {
  ChartCard,
  DataTable,
  PageError,
  type DataColumn,
} from "./DataComponents";

const percentOrDash = (value: number | null) =>
  value === null ? "—" : formatPercent(value, 2);

const columns: DataColumn<MonitoringMonth>[] = [
  { key: "month", label: "Month", render: (row) => row.month },
  { key: "count", label: "Assessments", render: (row) => row.assessments },
  {
    key: "rate",
    label: "Model flag rate",
    render: (row) => percentOrDash(row.flag_rate),
  },
  {
    key: "mean",
    label: "Mean probability",
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
        <PageError message="Monitoring data could not be loaded." />
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
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e8e2" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis unit="%" tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
              <Legend />
              <ReferenceLine
                y={monitoring.p0 * 100}
                stroke="#66736d"
                strokeDasharray="6 4"
                label={{ value: "p0", position: "insideTopRight" }}
              />
              <Line
                dataKey="flagRate"
                name="Model flag rate"
                stroke="#e66c4a"
                strokeWidth={2}
                connectNulls={false}
              />
              <Line
                dataKey="meanProbability"
                name="Mean probability"
                stroke="#1d5141"
                strokeWidth={2}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
      <DataTable
        columns={columns}
        rows={monitoring?.months ?? []}
        rowKey={(row) => row.month}
        loading={monitoringQuery.isPending}
        emptyLabel="No assessments yet."
      />
    </ChartCard>
  );
}
