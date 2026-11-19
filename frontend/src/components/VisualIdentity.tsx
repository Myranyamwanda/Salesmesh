import type { ReactNode } from "react";
import type { Band } from "../types/scoring";
import { formatPercent } from "../utils/format";
import { getInitials } from "../utils/identity";

const avatarColors = [
  ["#d9f6ec", "#123f35"],
  ["#dff0ff", "#173c59"],
  ["#ffedcf", "#563b12"],
  ["#efe4ff", "#3f2a63"],
  ["#ffe4ee", "#5a2940"],
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
  "High risk": "#b4232f",
  Watch: "#875300",
  "Low risk": "#147a5a",
  "Insufficient data": "#53627a",
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
  color = "var(--identity-blue)",
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
  const icon: Record<typeof direction, string> = {
    up: "↑",
    down: "↓",
    steady: "→",
  };
  return (
    <span className={`identity-trend-delta identity-trend-${direction}`}>
      <span aria-hidden="true">{icon[direction]}</span>{" "}
      <span className="visually-hidden">
        {direction === "up"
          ? "Increased by"
          : direction === "down"
            ? "Decreased by"
            : "No change"}
      </span>
      {Math.abs(difference).toLocaleString()} {label} vs previous month
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
          <stop offset="0" stopColor="#b5f3df" stopOpacity=".4" />
          <stop offset=".52" stopColor="#ffffff" stopOpacity=".86" />
          <stop offset="1" stopColor="#ffc96b" stopOpacity=".62" />
        </linearGradient>
        <radialGradient id="mesh-glow">
          <stop offset="0" stopColor="#75e0bd" stopOpacity=".28" />
          <stop offset="1" stopColor="#75e0bd" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="240" cy="153" rx="206" ry="126" fill="url(#mesh-glow)" />
      <g fill="none" stroke="url(#mesh-line)" strokeWidth="2">
        <path d="M56 178 143 83 243 145 337 56 422 126 349 228 243 145 156 238 56 178Z" />
        <path d="m143 83 13 155 181-182 5 172-99-83-187 33 220 50 146-102" />
        <path d="m56 178 200 1 81-123 85 70-179 19-87 93-100-60" />
      </g>
      <g stroke="#142342" strokeWidth="7">
        <circle cx="56" cy="178" r="13" fill="#ffc96b" />
        <circle cx="143" cy="83" r="16" fill="#dbfff3" />
        <circle cx="243" cy="145" r="21" fill="#73e0bc" />
        <circle cx="337" cy="56" r="12" fill="#ffc96b" />
        <circle cx="422" cy="126" r="16" fill="#dbfff3" />
        <circle cx="349" cy="228" r="13" fill="#73e0bc" />
        <circle cx="156" cy="238" r="12" fill="#ffc96b" />
      </g>
      <circle
        cx="243"
        cy="145"
        r="38"
        fill="none"
        stroke="#73e0bc"
        strokeOpacity=".3"
      />
      {children}
    </svg>
  );
}
