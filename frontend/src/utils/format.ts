export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** "—" for a rate with nothing to divide, never a misleading 0%. */
export function formatRate(value: number | null, digits = 1): string {
  return value === null ? "—" : formatPercent(value, digits);
}

export function formatHours(value: number | null): string {
  if (value === null) return "—";
  return value >= 48
    ? `${(value / 24).toFixed(1)} days`
    : `${value.toFixed(1)} h`;
}

/** A calendar date such as "2026-10-01", in the reader's locale (UTC day). */
export function formatLongDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}
