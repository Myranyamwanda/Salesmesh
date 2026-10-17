export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}
