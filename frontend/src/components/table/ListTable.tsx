import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
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
import { MeshMark } from "../VisualIdentity";
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
  /** Opens the row's details. Without it, rows are plain (no drawer). */
  onOpen?: (row: Row) => void;
  /** Adds a state class to each row/card without changing its content. */
  rowClassName?: (row: Row) => string | undefined;
  /**
   * A page for the row (e.g. agent detail). The title becomes a link: a
   * plain click or Enter opens the details, and Ctrl/Cmd/Shift-click or a
   * middle click opens this page in a new tab, as for any link.
   */
  href?: (row: Row) => string;
  /** The row whose details are open, highlighted in the list. */
  openKey?: string | null;
  loading?: boolean;
  /** Without total, page, size, onPage, and onSize there is no pager. */
  total?: number;
  page?: number;
  size?: number;
  sort?: string;
  dir?: SortDirection;
  onSort?: (key: string) => void;
  onPage?: (page: number) => void;
  onSize?: (size: number) => void;
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
    (event.target as HTMLElement).closest(
      "button, a, input, select, label, [role=button], [role=combobox], [role=switch]",
    ),
  );
}

/** A click the browser should handle itself (new tab or window). */
function opensElsewhere(event: MouseEvent) {
  return (
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  );
}

function TitleCell<Row>({
  row,
  content,
  onOpen,
  href,
}: {
  row: Row;
  content: ReactNode;
  onOpen: (row: Row) => void;
  href?: (row: Row) => string;
}) {
  if (href) {
    return (
      <Link
        to={href(row)}
        className="row-open"
        aria-haspopup="dialog"
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          onOpen(row);
        }}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="row-open"
      aria-haspopup="dialog"
      onClick={() => onOpen(row)}
    >
      {content}
    </button>
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
    href,
    openKey,
    loading = false,
    total,
    page = 1,
    size = 25,
    toolbar,
  } = props;
  const paged =
    total !== undefined &&
    props.onPage !== undefined &&
    props.onSize !== undefined;
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
            <ListCard
              row={row}
              columns={props.columns}
              onOpen={onOpen}
              href={href}
              className={props.rowClassName?.(row)}
            />
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
                  hover={Boolean(onOpen)}
                  selected={openKey === key}
                  className={
                    [onOpen && "list-row", props.rowClassName?.(row)]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  onClick={(event) => {
                    if (onOpen && !isControl(event)) onOpen(row);
                  }}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      align={column.numeric ? "right" : "left"}
                      className={cellClass(column)}
                    >
                      {column.card === "title" && onOpen ? (
                        <TitleCell
                          row={row}
                          content={column.render(row)}
                          onOpen={onOpen}
                          href={href}
                        />
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
      {paged && !loading && total > 0 && (
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
          onPageChange={(_, next) => props.onPage?.(next + 1)}
          onRowsPerPageChange={(event) =>
            props.onSize?.(Number(event.target.value))
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
  href,
  className,
}: {
  row: Row;
  columns: ListColumn<Row>[];
  onOpen?: (row: Row) => void;
  href?: (row: Row) => string;
  className?: string;
}) {
  const of = (place: ListColumn<Row>["card"]) =>
    columns.filter((column) => column.card === place);
  // Like a table row: the title is the keyboard way in, a click anywhere
  // else on the card opens it too, and links inside stay separate controls.
  return (
    <div
      className={[
        onOpen ? "list-card-row" : "list-card-row list-card-static",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(event) => {
        if (onOpen && !isControl(event)) onOpen(row);
      }}
    >
      <span className="list-card-head">
        <span className="list-card-title">
          {of("title").map((column) =>
            onOpen ? (
              <TitleCell
                key={column.key}
                row={row}
                content={column.render(row)}
                onOpen={onOpen}
                href={href}
              />
            ) : (
              <span key={column.key}>{column.render(row)}</span>
            ),
          )}
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
    </div>
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
  return (
    <div className="list-empty">
      <MeshMark className="identity-empty-illustration" />
      <Typography component="h2" className="list-empty-title">
        {filtered ? "No results match your search or filters" : emptyTitle}
      </Typography>
      <Typography color="text.secondary" className="list-empty-text">
        {filtered
          ? "Try a different search, or clear the filters to see every row."
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
