import { useMemo, useState } from "react";
import { Chip, Pagination, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import * as adminApi from "../api/admin";
import {
  DataTable,
  PageError,
  PageFilters,
  PageHeader,
  type DataColumn,
} from "../components/DataComponents";
import type { AuditRecord } from "../api/admin";
import { apiErrorMessage } from "../utils/errors";

export function AdminAuditLogPage() {
  const [page, setPage] = useState(0);
  const [limit] = useState(25);
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("all");
  const logsQuery = useQuery({
    queryKey: ["admin", "audit", page, limit],
    queryFn: () => adminApi.listAuditLogs(page * limit, limit),
  });
  const rows = useMemo(
    () =>
      (logsQuery.data?.items ?? []).filter((entry) => {
        const query = search.trim().toLowerCase();
        const matchesSearch =
          !query ||
          `${entry.action} ${entry.request_id ?? ""} ${entry.actor_user_id ?? ""} ${entry.target_user_id ?? ""}`
            .toLowerCase()
            .includes(query);
        return (
          matchesSearch && (outcome === "all" || entry.outcome === outcome)
        );
      }),
    [logsQuery.data?.items, search, outcome],
  );

  const columns: DataColumn<AuditRecord>[] = [
    {
      key: "time",
      label: "Time",
      render: (entry) => (
        <time dateTime={entry.created_at}>
          {new Date(entry.created_at).toLocaleString()}
        </time>
      ),
    },
    {
      key: "action",
      label: "Action",
      render: (entry) => <strong>{entry.action.replaceAll("_", " ")}</strong>,
    },
    {
      key: "outcome",
      label: "Outcome",
      render: (entry) => (
        <Chip
          size="small"
          label={entry.outcome}
          color={
            entry.outcome === "success"
              ? "success"
              : entry.outcome === "failure"
                ? "error"
                : "default"
          }
        />
      ),
    },
    {
      key: "subject",
      label: "Subject",
      render: (entry) => <code>{entry.subject ?? "—"}</code>,
    },
    {
      key: "actor",
      label: "Actor user ID",
      render: (entry) => <code>{entry.actor_user_id ?? "System"}</code>,
    },
    {
      key: "target",
      label: "Target user ID",
      render: (entry) => <code>{entry.target_user_id ?? "—"}</code>,
    },
    {
      key: "request",
      label: "Request ID",
      render: (entry) => <code>{entry.request_id ?? "—"}</code>,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Audit log"
        description="Authentication and account-management events. Credentials, tokens, and client IP addresses are not shown."
      />
      <div className="page-toolbar">
        <PageFilters
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(0);
          }}
          searchLabel="Search this page"
          filterLabel="Outcome"
          filterValue={outcome}
          onFilter={(value) => {
            setOutcome(value);
            setPage(0);
          }}
          filterOptions={[
            { value: "all", label: "All outcomes" },
            { value: "success", label: "Success" },
            { value: "failure", label: "Failure" },
          ]}
        />
      </div>
      {logsQuery.isError && (
        <PageError
          message={apiErrorMessage(
            logsQuery.error,
            "Could not load audit events.",
          )}
        />
      )}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(entry) => entry.id}
        loading={logsQuery.isLoading}
        emptyLabel={
          logsQuery.data?.total
            ? "No audit events match these filters."
            : "No audit events have been recorded yet."
        }
      />
      <div className="table-pagination">
        <Typography color="text.secondary">
          {logsQuery.data?.total ?? 0} events
        </Typography>
        <Pagination
          page={page + 1}
          count={Math.max(1, Math.ceil((logsQuery.data?.total ?? 0) / limit))}
          onChange={(_, nextPage) => setPage(nextPage - 1)}
          disabled={!logsQuery.data?.total}
          size="small"
          aria-label="Audit log pages"
        />
      </div>
    </>
  );
}
