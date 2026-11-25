import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as portalApi from "../../api/portal";
import { PageError, PageHeader } from "../../components/DataComponents";
import { ListTable, type ListColumn } from "../../components/table/ListTable";
import { TableToolbar } from "../../components/table/TableToolbar";
import {
  pageOffset,
  useClampPage,
  useListParams,
} from "../../components/table/useListParams";
import type { MyCustomer } from "../../types/scoring";
import { formatCount, formatDate } from "../../utils/format";

// Agents see only who they onboarded. Status, scores, and reputation are
// admin-only, because a customer's status would reveal whether it was flagged.
// Three columns and nothing more to show, so rows open no details.
const columns: ListColumn<MyCustomer>[] = [
  {
    key: "name",
    label: "Customer",
    card: "title",
    render: (row) => (
      <span className="cell-stack">
        <strong>{row.full_name}</strong>
      </span>
    ),
  },
  {
    key: "date",
    label: "Registered",
    card: "stat",
    render: (row) => formatDate(row.registered_at),
  },
  {
    key: "assisted",
    label: "Registered on my device",
    card: "stat",
    render: (row) => (row.assisted ? "Yes" : "No"),
  },
];

const deviceOptions = [
  { value: "all", label: "All customers" },
  { value: "yes", label: "On my device" },
  { value: "no", label: "On their own device" },
];

const listDefaults = {
  sort: "registered_at",
  dir: "desc",
  filters: { device: "all" },
} as const;

export function MyCustomersPage() {
  const { params, update, filtered, clearFilters } =
    useListParams(listDefaults);
  const device = params.filters.device;
  const customersQuery = useQuery({
    queryKey: ["me", "customers", params],
    queryFn: () =>
      portalApi.getMyCustomers({
        offset: pageOffset(params),
        limit: params.size,
        q: params.q.trim(),
        assisted: device === "all" ? undefined : device === "yes",
      }),
    placeholderData: keepPreviousData,
  });
  const total = customersQuery.data?.total;
  useClampPage(total, params, update);

  return (
    <>
      <PageHeader
        eyebrow="AGENT WORKSPACE"
        title="My customers"
        description="Customers who registered through your link."
      />
      {customersQuery.isError && (
        <PageError
          message="Your customers could not be loaded."
          error={customersQuery.error}
        />
      )}
      <ListTable
        label="My customers"
        columns={columns}
        rows={customersQuery.data?.items ?? []}
        rowKey={(row) => `${row.registered_at}-${row.full_name}`}
        loading={customersQuery.isPending}
        total={total ?? 0}
        page={params.page}
        size={params.size}
        onPage={(page) => update({ page })}
        onSize={(size) => update({ size })}
        filtered={filtered}
        onClearFilters={clearFilters}
        emptyTitle="No customers yet"
        emptyDescription="Share your link to get started."
        toolbar={
          <TableToolbar
            search={params.q}
            searchLabel="Search by name"
            onSearch={(q) => update({ q })}
            filters={[
              {
                name: "device",
                label: "Registered",
                value: device,
                options: deviceOptions,
              },
            ]}
            onFilter={(name, value) => update({ filters: { [name]: value } })}
            count={
              total === undefined
                ? undefined
                : `${formatCount(total)} ${total === 1 ? "customer" : "customers"}${filtered ? " match" : ""}`
            }
          />
        }
      />
    </>
  );
}
