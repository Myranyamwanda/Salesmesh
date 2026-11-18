import type { MouseEvent, ReactNode } from "react";
import {
  Button,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Typography,
  useMediaQuery,
} from "@mui/material";
import SearchOff from "@mui/icons-material/SearchOff";
import Inbox from "@mui/icons-material/Inbox";
import { formatCount } from "../../utils/format";
import { PAGE_SIZES, type SortDirection } from "./useListParams";

export type ListColumn<Row> = {
  key: string;
  label: string;
  render: (row: Row) => ReactNode;
  /** Right-aligned with even-width digits, so numbers line up. */
  numeric?: boolean;
  sortable?: boolean;
  /** Hide the column in a window narrower than this (px); see styles.css. */
  hideBelow?: 1100 | 1280;
  /**
   * Its place on a phone card: the title (which opens the details), a badge
   * beside the title, a small labelled stat, or a line below the stats.
   * Columns without one are left to the details drawer.
   */
  card?: "title" | "badge" | "stat" | "extra";
};

/**
 * Phones and tablets (no sidebar below 900 px) get cards instead of a table,
 * so the page never scrolls sideways (WCAG 1.4.10).
 */
export const CARDS_QUERY = "(max-width: 900px)";

type Props<Row> = {
  /** Names the table for screen readers, e.g. "Agents". */
  label: string;
  columns: ListColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  onOpen: (row: Row) => void;
  /** The row whose details are open, highlighted in the list. */
  openKey?: string | null;
  loading?: boolean;
  total: number;
  page: number;
  size: number;
  sort?: string;
  dir?: SortDirection;
  onSort?: (key: string) => void;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
  toolbar?: ReactNode;
  /** Filters or search are hiding rows, so offer to clear them. */
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyTitle: string;
  emptyDescription?: string;
};

function cellClass<Row>(column: ListColumn<Row>) {
  return (
    [
      column.numeric && "numeric",
      column.hideBelow && `hide-below-${column.hideBelow}`,
    ]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

function isControl(event: MouseEvent) {
  return Boolean(
    (event.target as HTMLElement).closest("button, a, input, [role=button]"),
  );
}

/**
 * The one list layout: toolbar, table (cards on a phone), empty and loading
 * states, and pagination, in a single card. Clicking a row, or its first
 * cell's button for keyboard users, opens the row's details.
 */
export function ListTable<Row>(props: Props<Row>) {
  const {
    label,
    rows,
    rowKey,
    onOpen,
    openKey,
    loading = false,
    total,
    page,
    size,
    toolbar,
  } = props;
  const phone = useMediaQuery(CARDS_QUERY);
  const columns = props.columns;

  let body: ReactNode;
  if (loading) {
    body = <LoadingRows phone={phone} columns={columns.length} label={label} />;
  } else if (rows.length === 0) {
    body = <EmptyRows {...props} />;
  } else if (phone) {
    body = (
      <ul className="list-cards" aria-label={label}>
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <ListCard row={row} columns={props.columns} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    );
  } else {
    body = (
      // Scrolls sideways inside the card only if a window is too narrow.
      <div className="list-table-scroll">
        <Table className="list-table" aria-label={label}>
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                <HeaderCell key={column.key} column={column} {...props} />
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const key = rowKey(row);
              return (
                <TableRow
                  key={key}
                  hover
                  selected={openKey === key}
                  className="list-row"
                  onClick={(event) => {
                    if (!isControl(event)) onOpen(row);
                  }}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      align={column.numeric ? "right" : "left"}
                      className={cellClass(column)}
                    >
                      {column.card === "title" ? (
                        <button
                          type="button"
                          className="row-open"
                          aria-haspopup="dialog"
                          onClick={() => onOpen(row)}
                        >
                          {column.render(row)}
                        </button>
                      ) : (
                        column.render(row)
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <Paper variant="outlined" className="list-card" aria-busy={loading}>
      {toolbar}
      {body}
      {!loading && total > 0 && (
        <TablePagination
          component="div"
          className="list-pager"
          count={total}
          page={Math.min(page - 1, Math.max(0, Math.ceil(total / size) - 1))}
          rowsPerPage={size}
          rowsPerPageOptions={[...PAGE_SIZES]}
          labelRowsPerPage="Rows per page"
          labelDisplayedRows={({ from, to, count }) =>
            `${formatCount(from)}–${formatCount(to)} of ${formatCount(count)}`
          }
          showFirstButton
          showLastButton
          onPageChange={(_, next) => props.onPage(next + 1)}
          onRowsPerPageChange={(event) =>
            props.onSize(Number(event.target.value))
          }
        />
      )}
    </Paper>
  );
}

function HeaderCell<Row>({
  column,
  sort,
  dir = "asc",
  onSort,
}: { column: ListColumn<Row> } & Props<Row>) {
  const active = sort === column.key;
  return (
    <TableCell
      align={column.numeric ? "right" : "left"}
      className={cellClass(column)}
      sortDirection={active ? dir : false}
    >
      {column.sortable && onSort ? (
        <TableSortLabel
          active={active}
          direction={active ? dir : "asc"}
          onClick={() => onSort(column.key)}
        >
          {column.label}
        </TableSortLabel>
      ) : (
        column.label
      )}
    </TableCell>
  );
}

function ListCard<Row>({
  row,
  columns,
  onOpen,
}: {
  row: Row;
  columns: ListColumn<Row>[];
  onOpen: (row: Row) => void;
}) {
  const of = (place: ListColumn<Row>["card"]) =>
    columns.filter((column) => column.card === place);
  return (
    <button
      type="button"
      className="list-card-row"
      aria-haspopup="dialog"
      onClick={() => onOpen(row)}
    >
      <span className="list-card-head">
        <span className="list-card-title">
          {of("title").map((column) => (
            <span key={column.key}>{column.render(row)}</span>
          ))}
        </span>
        {of("badge").map((column) => (
          <span key={column.key}>{column.render(row)}</span>
        ))}
      </span>
      <span className="list-card-stats">
        {of("stat").map((column) => (
          <span key={column.key} className="list-card-stat">
            <span className="list-card-stat-label">{column.label}</span>
            <span className="list-card-stat-value">{column.render(row)}</span>
          </span>
        ))}
      </span>
      {of("extra").map((column) => (
        <span key={column.key} className="list-card-extra">
          {column.render(row)}
        </span>
      ))}
    </button>
  );
}

function LoadingRows({
  phone,
  columns,
  label,
}: {
  phone: boolean;
  columns: number;
  label: string;
}) {
  return (
    <div className="list-loading">
      <span className="visually-hidden" role="status">
        Loading {label.toLowerCase()}…
      </span>
      {Array.from({ length: 6 }, (_, index) =>
        phone ? (
          <Skeleton
            key={index}
            variant="rounded"
            height={96}
            className="list-skeleton-card"
          />
        ) : (
          <div
            key={index}
            className="list-skeleton-row"
            style={{ gridTemplateColumns: `2fr repeat(${columns - 1}, 1fr)` }}
          >
            {Array.from({ length: columns }, (_, cell) => (
              <Skeleton key={cell} variant="text" height={20} />
            ))}
          </div>
        ),
      )}
    </div>
  );
}

function EmptyRows<Row>({
  filtered,
  onClearFilters,
  emptyTitle,
  emptyDescription,
}: Props<Row>) {
  const Icon = filtered ? SearchOff : Inbox;
  return (
    <div className="list-empty">
      <span className="list-empty-icon" aria-hidden="true">
        <Icon />
      </span>
      <Typography component="h2" className="list-empty-title">
        {filtered ? "No results match your search or filters" : emptyTitle}
      </Typography>
      <Typography color="text.secondary" className="list-empty-text">
        {filtered
          ? "Try a different name or email, or clear the filters to see every row."
          : emptyDescription}
      </Typography>
      {filtered && onClearFilters && (
        <Button variant="outlined" onClick={onClearFilters}>
          Clear search and filters
        </Button>
      )}
    </div>
  );
}
