import { useState } from "react";
import { TablePagination } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import * as portalApi from "../../api/portal";
import {
  DataTable,
  PageError,
  PageHeader,
  type DataColumn,
} from "../../components/DataComponents";
import type { MyCustomer } from "../../types/scoring";
import { formatDate } from "../../utils/format";

const PAGE_SIZE = 25;

// Agents see only who they onboarded. Status, scores, and reputation are
// admin-only, because a customer's status would reveal whether it was flagged.
const columns: DataColumn<MyCustomer>[] = [
  { key: "name", label: "Customer", render: (row) => row.full_name },
  {
    key: "date",
    label: "Registered",
    render: (row) => formatDate(row.registered_at),
  },
  {
    key: "assisted",
    label: "Registered on my device",
    render: (row) => (row.assisted ? "Yes" : "No"),
  },
];

export function MyCustomersPage() {
  const [page, setPage] = useState(0);
  const customersQuery = useQuery({
    queryKey: ["me", "customers", page],
    queryFn: () => portalApi.getMyCustomers(page * PAGE_SIZE, PAGE_SIZE),
  });
  return (
    <>
      <PageHeader
        eyebrow="AGENT WORKSPACE"
        title="My customers"
        description="Customers who registered through your link."
      />
      {customersQuery.isError && (
        <PageError message="Your customers could not be loaded." />
      )}
      <DataTable
        columns={columns}
        rows={customersQuery.data?.items ?? []}
        rowKey={(row) => `${row.registered_at}-${row.full_name}`}
        loading={customersQuery.isPending}
        emptyLabel="No customers yet. Share your link to get started."
      />
      <TablePagination
        component="div"
        count={customersQuery.data?.total ?? 0}
        page={page}
        onPageChange={(_, next) => setPage(next)}
        rowsPerPage={PAGE_SIZE}
        rowsPerPageOptions={[PAGE_SIZE]}
      />
    </>
  );
}
