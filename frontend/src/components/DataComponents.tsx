import { useId, type ReactNode } from "react";
import type { Band, CustomerStatus, ReasonSource } from "../types/scoring";
import {
  Alert,
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="workspace-page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <Typography component="h1" variant="h4">
          {title}
        </Typography>
        {description && (
          <Typography color="text.secondary">{description}</Typography>
        )}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({
  title = "Nothing to show yet",
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="data-empty-state">
      <span className="empty-rule" aria-hidden="true" />
      <Typography component="h3" variant="h6">
        {title}
      </Typography>
      {description && (
        <Typography color="text.secondary">{description}</Typography>
      )}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  detail,
}: {
  label: string;
  value?: string | number | null;
  detail?: string;
}) {
  return (
    <Paper className="kpi-card" variant="outlined" square>
      <Typography className="kpi-label">{label}</Typography>
      <Typography className="kpi-value">
        {value ?? <span aria-label="Not available">—</span>}
      </Typography>
      {detail && (
        <Typography className="kpi-detail" color="text.secondary">
          {detail}
        </Typography>
      )}
    </Paper>
  );
}

export function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <Paper className="chart-card" variant="outlined" square>
      <div className="chart-card-heading">
        <Typography component="h2" variant="h6">
          {title}
        </Typography>
        {description && (
          <Typography color="text.secondary">{description}</Typography>
        )}
      </div>
      {children}
    </Paper>
  );
}

// Badges always show a text label, so meaning never depends on colour alone.
const bandColors = {
  "High risk": "error",
  Watch: "warning",
  "Low risk": "success",
  "Insufficient data": "default",
} as const;

export function BandBadge({ band }: { band: Band }) {
  return (
    <Chip
      size="small"
      label={band}
      color={bandColors[band]}
      variant={band === "Insufficient data" ? "outlined" : "filled"}
    />
  );
}

export function SourceChip({ source }: { source: ReasonSource }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={source === "rule" ? "secondary" : "primary"}
      label={source === "rule" ? "Rule" : "Model"}
    />
  );
}

const statusLabels = {
  pending_review: { label: "Pending review", color: "warning" },
  verified: { label: "Verified", color: "success" },
  rejected: { label: "Rejected", color: "error" },
} as const;

export function StatusChip({ status }: { status: CustomerStatus }) {
  const { label, color } = statusLabels[status];
  return <Chip size="small" variant="outlined" color={color} label={label} />;
}

export type DataColumn<Row> = {
  key: string;
  label: string;
  render: (row: Row) => ReactNode;
};

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyLabel = "No records found.",
}: {
  columns: DataColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  emptyLabel?: string;
}) {
  if (loading) {
    return (
      <Skeleton variant="rectangular" height={180} className="table-skeleton" />
    );
  }
  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      square
      className="data-table-wrap"
    >
      <Table size="small" aria-label="Data table">
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell key={column.key}>{column.label}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow hover key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell key={column.key}>{column.render(row)}</TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={Math.max(columns.length, 1)}>
                <Box className="table-empty">{emptyLabel}</Box>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function PageFilters({
  search,
  onSearch,
  searchLabel = "Search",
  filterLabel,
  filterValue,
  filterOptions = [],
  onFilter,
}: {
  search?: string;
  onSearch?: (value: string) => void;
  searchLabel?: string;
  filterLabel?: string;
  filterValue?: string;
  filterOptions?: { value: string; label: string }[];
  onFilter?: (value: string) => void;
}) {
  // Links the visible label to the select, so screen readers announce it.
  const filterLabelId = useId();
  return (
    <div className="page-filters">
      {onSearch && (
        <TextField
          label={searchLabel}
          value={search ?? ""}
          onChange={(event) => onSearch(event.target.value)}
          size="small"
          type="search"
        />
      )}
      {onFilter && filterLabel && (
        <FormControl size="small" className="page-filter-select">
          <InputLabel id={filterLabelId}>{filterLabel}</InputLabel>
          <Select
            labelId={filterLabelId}
            label={filterLabel}
            value={filterValue ?? ""}
            onChange={(event) => onFilter(event.target.value)}
          >
            {filterOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </div>
  );
}

export function PageError({ message }: { message: string }) {
  return <Alert severity="error">{message}</Alert>;
}
