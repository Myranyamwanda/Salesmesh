import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DataTable, type DataColumn } from "./DataComponents";
import type { MonthKpi } from "../types/scoring";
import { formatHours, formatRate } from "../utils/format";

// One series per chart, so no legend box: the card title names it. Colour is
// categorical slot 1 of the dataviz reference palette, validated on white.
const SERIES = "#2a78d6";
const GRID = "#e3e8e2";
const AXIS_TEXT = "#52514e";

/** A single-series monthly line. Null months stay gaps, never a fake 0. */
export function MonthlyLineChart<Row extends { month: string }>({
  rows,
  value,
  name,
  format,
  domain = ["auto", "auto"],
  height = 260,
}: {
  rows: Row[];
  value: (row: Row) => number | null;
  name: string;
  format: (value: number) => string;
  domain?: [number | "auto", number | "auto"];
  height?: number;
}) {
  const data = rows.map((row) => ({ month: row.month, value: value(row) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12, fill: AXIS_TEXT }}
          tickLine={false}
        />
        <YAxis
          domain={domain}
          tick={{ fontSize: 12, fill: AXIS_TEXT }}
          tickFormatter={format}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          formatter={(raw) =>
            typeof raw === "number" ? [format(raw), name] : ["No data", name]
          }
        />
        <Line
          type="monotone"
          dataKey="value"
          name={name}
          stroke={SERIES}
          strokeWidth={2}
          dot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: SERIES }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** The KPI columns shared by the agent and network tables. */
function kpiColumns<Row extends MonthKpi>(): DataColumn<Row>[] {
  return [
    { key: "month", label: "Month", render: (row) => row.month },
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
      key: "fake_rate",
      label: "Confirmed fake",
      render: (row) => formatRate(row.confirmed_fake_rate),
    },
    {
      key: "verification",
      label: "Verification rate",
      render: (row) => formatRate(row.verification_rate),
    },
    {
      key: "review_time",
      label: "Avg time to review",
      render: (row) => formatHours(row.avg_hours_to_review),
    },
    { key: "eligible", label: "Eligible", render: (row) => row.eligible },
  ];
}

export function KpiTable<Row extends MonthKpi>({
  rows,
  extra = [],
  loading,
  label,
}: {
  rows: Row[];
  extra?: DataColumn<Row>[];
  loading: boolean;
  label: string;
}) {
  return (
    <DataTable
      columns={[...kpiColumns<Row>(), ...extra]}
      // Newest month first for reading; charts run oldest to newest.
      rows={[...rows].reverse()}
      rowKey={(row) => row.month}
      loading={loading}
      emptyLabel={label}
    />
  );
}
