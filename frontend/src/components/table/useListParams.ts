import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export const PAGE_SIZES = [10, 25, 50] as const;
const DEFAULT_SIZE = 25;

export type SortDirection = "asc" | "desc";

export type ListParams = {
  page: number;
  /** Rows per page: 10, 25, or 50. */
  size: number;
  q: string;
  sort: string;
  dir: SortDirection;
  filters: Record<string, string>;
};

type Defaults = {
  sort: string;
  dir: SortDirection;
  /** Filter names with their "show everything" value, e.g. { band: "all" }. */
  filters?: Record<string, string>;
  /** Prefix for the URL keys when a page has two lists, e.g. "bench_". */
  prefix?: string;
};

const NO_FILTERS: Record<string, string> = {};

/**
 * Pass `defaults` as a module-level constant, so it keeps one identity.
 *
 * A list's page, page size, search, sort, and filters, kept in the URL so a
 * reload, the back button, or a shared link shows the same rows. Default
 * values are left out of the URL to keep it short.
 */
export function useListParams(defaults: Defaults) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filterDefaults = defaults.filters ?? NO_FILTERS;
  const prefix = defaults.prefix ?? "";

  const params: ListParams = useMemo(() => {
    const read = (name: string) => searchParams.get(prefix + name);
    const size = Number(read("size"));
    const page = Number(read("page"));
    const dir = read("dir");
    return {
      page: Number.isInteger(page) && page > 0 ? page : 1,
      size: (PAGE_SIZES as readonly number[]).includes(size)
        ? size
        : DEFAULT_SIZE,
      q: read("q") ?? "",
      sort: read("sort") ?? defaults.sort,
      dir: dir === "asc" || dir === "desc" ? dir : defaults.dir,
      filters: Object.fromEntries(
        Object.entries(filterDefaults).map(([name, fallback]) => [
          name,
          read(name) ?? fallback,
        ]),
      ),
    };
  }, [searchParams, prefix, defaults.sort, defaults.dir, filterDefaults]);

  /** Change some values. Anything but a page change goes back to page 1. */
  const update = useCallback(
    (
      changes: Partial<Omit<ListParams, "filters">> & {
        filters?: Record<string, string>;
      },
    ) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          const values: Record<string, string | number | undefined> = {
            page: changes.page ?? (Object.keys(changes).length ? 1 : undefined),
            size: changes.size,
            q: changes.q,
            sort: changes.sort,
            dir: changes.dir,
            ...changes.filters,
          };
          const fallbacks: Record<string, string | number> = {
            page: 1,
            size: DEFAULT_SIZE,
            q: "",
            sort: defaults.sort,
            dir: defaults.dir,
            ...filterDefaults,
          };
          for (const [name, value] of Object.entries(values)) {
            if (value === undefined) continue;
            const key = prefix + name;
            if (String(value) === String(fallbacks[name])) next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        // Typing and paging replace the entry, so Back leaves the page.
        { replace: true },
      );
    },
    [setSearchParams, prefix, defaults.sort, defaults.dir, filterDefaults],
  );

  const filtered =
    params.q !== "" ||
    Object.entries(params.filters).some(
      ([name, value]) => value !== filterDefaults[name],
    );

  const clearFilters = useCallback(
    () => update({ q: "", filters: filterDefaults }),
    [update, filterDefaults],
  );

  return { params, update, filtered, clearFilters };
}

/** The API offset of the current page. */
export function pageOffset(params: Pick<ListParams, "page" | "size">) {
  return (params.page - 1) * params.size;
}

/**
 * If the total shrinks below the current page (a row was removed, or an old
 * link), go to the last page instead of showing an empty one.
 */
export function useClampPage(
  total: number | undefined,
  params: Pick<ListParams, "page" | "size">,
  update: (changes: { page: number }) => void,
) {
  useEffect(() => {
    if (total === undefined) return;
    const last = Math.max(1, Math.ceil(total / params.size));
    if (params.page > last) update({ page: last });
  }, [total, params.page, params.size, update]);
}

/**
 * Search, sort, and page rows the API sends in full (a short list, such as
 * one row per agent in a report). Server-side lists use offset/limit.
 */
export function pageRows<Row>(
  rows: Row[],
  params: ListParams,
  options: {
    matches?: (row: Row, term: string) => boolean;
    sortValue?: (row: Row, key: string) => string | number | null;
  } = {},
) {
  const term = params.q.trim().toLowerCase();
  let matching =
    term && options.matches
      ? rows.filter((row) => options.matches!(row, term))
      : rows;
  const { sortValue } = options;
  if (sortValue) {
    const sign = params.dir === "asc" ? 1 : -1;
    matching = [...matching].sort((a, b) => {
      const left = sortValue(a, params.sort);
      const right = sortValue(b, params.sort);
      // Missing values ("—") go last in both directions.
      if (left === null || right === null) {
        return left === right ? 0 : left === null ? 1 : -1;
      }
      return (
        sign *
        (typeof left === "string"
          ? left.localeCompare(String(right))
          : left - Number(right))
      );
    });
  }
  const last = Math.max(1, Math.ceil(matching.length / params.size));
  const page = Math.min(params.page, last);
  return {
    rows: matching.slice((page - 1) * params.size, page * params.size),
    total: matching.length,
    page,
  };
}
