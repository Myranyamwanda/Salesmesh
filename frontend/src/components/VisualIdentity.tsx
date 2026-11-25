import TrendingDownRounded from "@mui/icons-material/TrendingDownRounded";
import TrendingFlatRounded from "@mui/icons-material/TrendingFlatRounded";
import TrendingUpRounded from "@mui/icons-material/TrendingUpRounded";
import { useId, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
} from "recharts";
import type { Band } from "../types/scoring";
import { formatPercent } from "../utils/format";
import { getInitials } from "../utils/identity";

// Tint and text pairs, each at least 4.5:1.
const avatarColors = [
  ["#eceafe", "#3730a3"],
  ["#cffafe", "#155e75"],
  ["#ecfccb", "#3f6212"],
  ["#f3e8ff", "#6b21a8"],
  ["#e0e7ff", "#312e81"],
] as const;

function colorIndex(name: string) {
  let hash = 0;
  for (const character of name) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % avatarColors.length;
}

export function InitialsAvatar({
  name,
  seed,
  size = "regular",
}: {
  name: string;
  seed?: string;
  size?: "regular" | "large";
}) {
  const [backgroundColor, color] = avatarColors[colorIndex(seed ?? name)];
  return (
    <span
      className={`identity-avatar identity-avatar-${size}`}
      style={{ backgroundColor, color }}
      aria-hidden="true"
    >
      {getInitials(name)}
    </span>
  );
}

const bandColors: Record<Band, string> = {
  "High risk": "#be123c",
  Watch: "#b45309",
  "Low risk": "#4d7c0f",
  "Insufficient data": "#6b6890",
};

export function ReputationGauge({
  value,
  band,
  size = "regular",
}: {
  value: number;
  band: Band;
  size?: "regular" | "large";
}) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const bounded = Math.min(100, Math.max(0, value));
  return (
    <span
      className={`identity-score identity-score-${size}`}
      role="img"
      aria-label={`Reputation ${value.toFixed(1)} out of 100`}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="identity-score-track" cx="20" cy="20" r={radius} />
        <circle
          className="identity-score-progress"
          cx="20"
          cy="20"
          r={radius}
          stroke={bandColors[band]}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - bounded / 100)}
        />
      </svg>
      <span className="identity-score-number">{value.toFixed(1)}</span>
    </span>
  );
}

export function ProbabilityMeter({ value }: { value: number }) {
  const percent = Math.min(100, Math.max(0, value * 100));
  const label = formatPercent(value);
  return (
    <span className="identity-probability">
      <span
        className="identity-probability-meter"
        role="meter"
        aria-label="Model probability"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label}
      >
        <span className="identity-probability-track" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </span>
      </span>
      <span className="identity-probability-value">{label}</span>
    </span>
  );
}

function sparklinePaths(values: (number | null)[]) {
  const points = values.flatMap((value) => (value === null ? [] : [value]));
  if (points.length < 2) return [];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const height = 28;
  const width = 78;
  const coordinates = values.map((value, index) =>
    value === null
      ? null
      : {
          x: (index / Math.max(1, values.length - 1)) * width,
          y: height - 3 - ((value - min) / range) * (height - 6),
        },
  );
  const segments: { x: number; y: number }[][] = [];
  let segment: { x: number; y: number }[] = [];
  for (const point of coordinates) {
    if (point) {
      segment.push(point);
    } else {
      if (segment.length) segments.push(segment);
      segment = [];
    }
  }
  if (segment.length) segments.push(segment);
  return segments
    .filter((segment) => segment.length > 1)
    .map((segment) =>
      segment
        .map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`)
        .join(" "),
    );
}

export function MiniSparkline({
  values,
  label,
  color = "var(--primary)",
  className = "",
}: {
  values: (number | null)[];
  label: string;
  color?: string;
  className?: string;
}) {
  const valid = values.filter((value): value is number => value !== null);
  if (valid.length < 2) {
    return (
      <span className={`identity-trend-empty ${className}`}>
        Trend unavailable
      </span>
    );
  }
  const paths = sparklinePaths(values);
  return (
    <span
      className={`identity-sparkline ${className}`}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 78 28" aria-hidden="true">
        {paths.map((path, index) => (
          <path
            key={index}
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </span>
  );
}

export function ReputationTrend({
  name,
  values,
}: {
  name: string;
  values: (number | null)[];
}) {
  const valid = values.filter((value): value is number => value !== null);
  return (
    <MiniSparkline
      values={values}
      className="identity-reputation-trend"
      label={
        valid.length >= 2
          ? `Six-month reputation trend for ${name}, from ${valid[0].toFixed(1)} to ${valid[valid.length - 1].toFixed(1)}`
          : `Six-month reputation trend unavailable for ${name}`
      }
    />
  );
}

/** "+12% vs last month", with an arrow; the words carry the meaning. */
export function TrendDelta({
  current,
  previous,
  label,
}: {
  current: number | null;
  previous: number | null;
  label: string;
}) {
  if (current === null || previous === null) {
    return <span className="identity-trend-delta">No previous month</span>;
  }
  const difference = current - previous;
  const direction = difference > 0 ? "up" : difference < 0 ? "down" : "steady";
  const Icon =
    direction === "up"
      ? TrendingUpRounded
      : direction === "down"
        ? TrendingDownRounded
        : TrendingFlatRounded;
  const sign = difference > 0 ? "+" : "−";
  // A percentage needs a previous value; from zero, show the count instead.
  const amount =
    previous === 0
      ? `${sign}${Math.abs(difference).toLocaleString()}`
      : `${sign}${Math.round((Math.abs(difference) / previous) * 100)}%`;
  return (
    <span
      className={`identity-trend-delta identity-trend-${direction}`}
      title={`${label}: ${previous.toLocaleString()} last month, ${current.toLocaleString()} this month`}
    >
      <Icon fontSize="inherit" aria-hidden="true" />
      {direction === "steady" ? "No change" : amount} vs last month
    </span>
  );
}

/** "2026-10" -> "Oct", for chart axes. */
function shortMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  if (!year || !number) return month;
  return (
    [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ][number - 1] ?? month
  );
}

/** A small month-by-month chart for a KPI card: gradient area or bars. */
export function KpiTrendChart({
  kind,
  months,
  values,
  name,
  from,
  to,
  stroke,
}: {
  kind: "area" | "bar";
  months: string[];
  values: number[];
  name: string;
  from: string;
  to: string;
  stroke: string;
}) {
  const id = useId().replace(/:/g, "");
  if (values.length < 2) {
    return <span className="identity-trend-empty">Trend unavailable</span>;
  }
  const data = months.map((month, index) => ({
    month: shortMonth(month),
    value: values[index],
  }));
  const summary = `${name} per month: ${data
    .map((point) => `${point.month} ${point.value.toLocaleString()}`)
    .join(", ")}.`;
  const axis = { fontSize: 11, fill: "#575478" };
  const margin = { top: 6, right: 4, left: 4, bottom: 0 };
  return (
    <div className="identity-kpi-chart" role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height={92}>
        {kind === "area" ? (
          <AreaChart data={data} margin={margin}>
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={from} stopOpacity={0.5} />
                <stop offset="1" stopColor={to} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={axis}
              interval="preserveStartEnd"
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={stroke}
              strokeWidth={2.5}
              fill={`url(#${id}-fill)`}
              isAnimationActive={false}
            />
          </AreaChart>
        ) : (
          <BarChart data={data} margin={margin}>
            <defs>
              <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={from} />
                <stop offset="1" stopColor={to} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={axis}
              interval="preserveStartEnd"
            />
            <Bar
              dataKey="value"
              fill={`url(#${id}-bar)`}
              radius={[6, 6, 2, 2]}
              maxBarSize={22}
              isAnimationActive={false}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** The SalesMesh mark: four connected nodes (a small mesh) on a rounded tile. */
export function LogoMark({ size = 34 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${id}-tile)`} />
      <g
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.9"
      >
        <path d="M20 9 L9.5 27.5 L30.5 27.5 Z" />
        <path d="M20 9 L20 20.5 M9.5 27.5 L20 20.5 L30.5 27.5" />
      </g>
      <circle
        cx="20"
        cy="9"
        r="4"
        fill="#a3e635"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle
        cx="9.5"
        cy="27.5"
        r="4"
        fill="#22d3ee"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle
        cx="30.5"
        cy="27.5"
        r="4"
        fill="#a3e635"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle cx="20" cy="20.5" r="3.2" fill="#ffffff" />
    </svg>
  );
}

/** Mark plus "SalesMesh" wordmark; the visible text is the accessible name. */
export function BrandLogo({ size = 34 }: { size?: number }) {
  return (
    <span className="brand-logo">
      <LogoMark size={size} />
      <span className="brand-wordmark">
        Sales<span>Mesh</span>
      </span>
    </span>
  );
}

export function MeshMark({
  className = "",
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <svg
      className={`mesh-mark ${className}`}
      viewBox="0 0 480 300"
      role="img"
      aria-label="Connected nodes represent the SalesMesh network"
    >
      <defs>
        <linearGradient id="mesh-line" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity=".45" />
          <stop offset=".52" stopColor="#7c3aed" stopOpacity=".8" />
          <stop offset="1" stopColor="#a3e635" stopOpacity=".7" />
        </linearGradient>
        <radialGradient id="mesh-glow">
          <stop offset="0" stopColor="#4f46e5" stopOpacity=".14" />
          <stop offset="1" stopColor="#4f46e5" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="240" cy="153" rx="206" ry="126" fill="url(#mesh-glow)" />
      <g fill="none" stroke="url(#mesh-line)" strokeWidth="2">
        <path d="M56 178 143 83 243 145 337 56 422 126 349 228 243 145 156 238 56 178Z" />
        <path d="m143 83 13 155 181-182 5 172-99-83-187 33 220 50 146-102" />
        <path d="m56 178 200 1 81-123 85 70-179 19-87 93-100-60" />
      </g>
      <g stroke="#ffffff" strokeWidth="6">
        <circle cx="56" cy="178" r="13" fill="#a3e635" />
        <circle cx="143" cy="83" r="16" fill="#22d3ee" />
        <circle cx="243" cy="145" r="21" fill="#4f46e5" />
        <circle cx="337" cy="56" r="12" fill="#a3e635" />
        <circle cx="422" cy="126" r="16" fill="#22d3ee" />
        <circle cx="349" cy="228" r="13" fill="#7c3aed" />
        <circle cx="156" cy="238" r="12" fill="#a3e635" />
      </g>
      <circle
        cx="243"
        cy="145"
        r="38"
        fill="none"
        stroke="#7c3aed"
        strokeOpacity=".25"
      />
      {children}
    </svg>
  );
}
