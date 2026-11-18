import { useCallback, useMemo } from "react";
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

  const params: ListParams = useMemo(() => {
    const size = Number(searchParams.get("size"));
    const page = Number(searchParams.get("page"));
    const dir = searchParams.get("dir");
    return {
      page: Number.isInteger(page) && page > 0 ? page : 1,
      size: (PAGE_SIZES as readonly number[]).includes(size)
        ? size
        : DEFAULT_SIZE,
      q: searchParams.get("q") ?? "",
      sort: searchParams.get("sort") ?? defaults.sort,
      dir: dir === "asc" || dir === "desc" ? dir : defaults.dir,
      filters: Object.fromEntries(
        Object.entries(filterDefaults).map(([name, fallback]) => [
          name,
          searchParams.get(name) ?? fallback,
        ]),
      ),
    };
  }, [searchParams, defaults.sort, defaults.dir, filterDefaults]);

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
            if (String(value) === String(fallbacks[name])) next.delete(name);
            else next.set(name, String(value));
          }
          return next;
        },
        // Typing and paging replace the entry, so Back leaves the page.
        { replace: true },
      );
    },
    [setSearchParams, defaults.sort, defaults.dir, filterDefaults],
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
