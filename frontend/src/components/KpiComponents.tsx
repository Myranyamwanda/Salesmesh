import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { DetailDrawer, DetailSection } from "./table/DetailDrawer";
import { ListTable, type ListColumn } from "./table/ListTable";
import type { MonthKpi } from "../types/scoring";
import { chart } from "../tokens";
import { formatCount, formatHours, formatRate } from "../utils/format";

// One series per chart, so no legend box: the card title names it. Colour is
// categorical slot 1 of the dataviz reference palette, validated on white.

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
        <CartesianGrid stroke={chart.grid} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12, fill: chart.axis }}
          tickLine={false}
        />
        <YAxis
          domain={domain}
          tick={{ fontSize: 12, fill: chart.axis }}
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
          stroke={chart.series}
          strokeWidth={2}
          dot={{
            r: 4,
            strokeWidth: 2,
            stroke: chart.markerRing,
            fill: chart.series,
          }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: chart.markerRing }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** The KPI columns shared by the agent and network tables. */
function kpiColumns<Row extends MonthKpi>(): ListColumn<Row>[] {
  return [
    { key: "month", label: "Month", card: "title", render: (row) => row.month },
    {
      key: "registrations",
      label: "Registrations",
      numeric: true,
      card: "stat",
      render: (row) => formatCount(row.registrations),
    },
    {
      key: "flag_rate",
      label: "Flag rate",
      numeric: true,
      card: "stat",
      render: (row) => formatRate(row.flag_rate),
    },
    {
      key: "fake_rate",
      label: "Confirmed fake",
      numeric: true,
      card: "stat",
      render: (row) => formatRate(row.confirmed_fake_rate),
    },
    {
      key: "verification",
      label: "Verification rate",
      numeric: true,
      hideBelow: 1100,
      render: (row) => formatRate(row.verification_rate),
    },
  ];
}

/** Every figure of one month, for the details drawer. */
function kpiDetails(row: MonthKpi) {
  return [
    {
      title: "Registrations",
      items: [
        { label: "Registrations", value: formatCount(row.registrations) },
        { label: "Flagged", value: formatCount(row.flagged) },
        { label: "Flag rate", value: formatRate(row.flag_rate) },
        { label: "Eligible", value: formatCount(row.eligible) },
      ],
    },
    {
      title: "Reviews",
      items: [
        { label: "Reviewed", value: formatCount(row.reviewed) },
        { label: "Confirmed real", value: formatCount(row.confirmed_real) },
        { label: "Confirmed fake", value: formatCount(row.confirmed_fake) },
        {
          label: "Confirmed fake rate",
          value: formatRate(row.confirmed_fake_rate),
        },
        {
          label: "Verification rate",
          value: formatRate(row.verification_rate),
        },
        {
          label: "Average time to review",
          value: formatHours(row.avg_hours_to_review),
        },
      ],
    },
  ];
}

/**
 * Twelve months, newest first: a fixed report, so no search or pager.
 * A row opens every figure of that month.
 */
export function KpiTable<Row extends MonthKpi>({
  rows,
  extra = [],
  loading,
  label,
  extraDetails = () => [],
}: {
  rows: Row[];
  extra?: ListColumn<Row>[];
  loading: boolean;
  label: string;
  extraDetails?: (row: Row) => { label: string; value: string }[];
}) {
  const [open, setOpen] = useState<Row | null>(null);
  return (
    <>
      <ListTable
        label="Monthly KPIs"
        columns={[...kpiColumns<Row>(), ...extra]}
        // Newest month first for reading; charts run oldest to newest.
        rows={[...rows].reverse()}
        rowKey={(row) => row.month}
        onOpen={setOpen}
        openKey={open?.month}
        loading={loading}
        emptyTitle={label}
      />
      <DetailDrawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? `KPIs for ${open.month}` : ""}
      >
        {open &&
          kpiDetails(open).map((section, index) => (
            <DetailSection
              key={section.title}
              title={section.title}
              items={
                index === 0
                  ? [...section.items, ...extraDetails(open)]
                  : section.items
              }
            />
          ))}
      </DetailDrawer>
    </>
  );
}
