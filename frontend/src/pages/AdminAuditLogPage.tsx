import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as adminApi from "../api/admin";
import type { AuditRecord } from "../api/admin";
import { PageError, PageHeader } from "../components/DataComponents";
import { DetailDrawer, DetailSection } from "../components/table/DetailDrawer";
import { ListTable, type ListColumn } from "../components/table/ListTable";
import { StatusBadge } from "../components/table/StatusBadge";
import { TableToolbar } from "../components/table/TableToolbar";
import {
  pageOffset,
  useClampPage,
  useListParams,
} from "../components/table/useListParams";
import { apiErrorMessage } from "../utils/errors";
import { formatCount, formatDateTime } from "../utils/format";

const actionLabel = (entry: AuditRecord) => entry.action.replaceAll("_", " ");

function Outcome({ entry }: { entry: AuditRecord }) {
  if (entry.outcome === "success") {
    return <StatusBadge tone="success" label="Success" />;
  }
  if (entry.outcome === "failure") {
    return <StatusBadge tone="error" label="Failure" />;
  }
  return <StatusBadge tone="neutral" label={entry.outcome} />;
}

/** The first block of a user ID is enough to tell entries apart. */
function ShortId({ id, empty }: { id: string | null; empty: string }) {
  if (!id) return <span className="muted-dash">{empty}</span>;
  return (
    <code className="code-text" title={id}>
      {id.slice(0, 8)}…
    </code>
  );
}

const columns: ListColumn<AuditRecord>[] = [
  {
    key: "time",
    label: "Time",
    card: "stat",
    render: (entry) => (
      <time dateTime={entry.created_at}>
        {formatDateTime(entry.created_at)}
      </time>
    ),
  },
  {
    key: "action",
    label: "Action",
    card: "title",
    render: (entry) => (
      <span className="cell-stack">
        <strong className="sentence-case">{actionLabel(entry)}</strong>
      </span>
    ),
  },
  {
    key: "outcome",
    label: "Outcome",
    card: "badge",
    render: (entry) => <Outcome entry={entry} />,
  },
  {
    key: "actor",
    label: "Actor",
    card: "stat",
    render: (entry) => <ShortId id={entry.actor_user_id} empty="System" />,
  },
  {
    key: "subject",
    label: "Target or subject",
    hideBelow: 1100,
    render: (entry) =>
      entry.subject ? (
        <code className="code-text">{entry.subject}</code>
      ) : (
        <ShortId id={entry.target_user_id} empty="—" />
      ),
  },
];

const outcomeOptions = [
  { value: "all", label: "All outcomes" },
  { value: "success", label: "Success" },
  { value: "failure", label: "Failure" },
];

const listDefaults = {
  sort: "created_at",
  dir: "desc",
  filters: { outcome: "all" },
} as const;

function EntryDrawer({
  entry,
  onClose,
}: {
  entry: AuditRecord | null;
  onClose: () => void;
}) {
  const id = (value: string | null, empty = "—") =>
    value ? <code className="code-text">{value}</code> : empty;
  return (
    <DetailDrawer
      open={entry !== null}
      onClose={onClose}
      title={entry ? actionLabel(entry) : ""}
      subtitle={entry ? formatDateTime(entry.created_at) : undefined}
      badge={entry && <Outcome entry={entry} />}
    >
      {entry && (
        <DetailSection
          title="Event"
          items={[
            { label: "Action code", value: id(entry.action) },
            {
              label: "Actor user ID",
              value: id(entry.actor_user_id, "System"),
            },
            { label: "Target user ID", value: id(entry.target_user_id) },
            { label: "Subject", value: id(entry.subject) },
            { label: "Request ID", value: id(entry.request_id) },
          ]}
        />
      )}
    </DetailDrawer>
  );
}

export function AdminAuditLogPage() {
  const { params, update, filtered, clearFilters } =
    useListParams(listDefaults);
  const [openEntry, setOpenEntry] = useState<AuditRecord | null>(null);
  const outcome = params.filters.outcome;
  const logsQuery = useQuery({
    queryKey: ["admin", "audit", params],
    queryFn: () =>
      adminApi.listAuditLogs({
        offset: pageOffset(params),
        limit: params.size,
        q: params.q.trim(),
        outcome:
          outcome === "success" || outcome === "failure" ? outcome : undefined,
      }),
    placeholderData: keepPreviousData,
  });
  const total = logsQuery.data?.total;
  useClampPage(total, params, update);

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Audit log"
        description="Authentication and account-management events, newest first. Credentials, tokens, and client IP addresses are not shown."
      />
      {logsQuery.isError && (
        <PageError
          message={apiErrorMessage(
            logsQuery.error,
            "Could not load audit events.",
          )}
        />
      )}
      <ListTable
        label="Audit events"
        columns={columns}
        rows={logsQuery.data?.items ?? []}
        rowKey={(entry) => entry.id}
        onOpen={setOpenEntry}
        openKey={openEntry?.id}
        loading={logsQuery.isPending}
        total={total ?? 0}
        page={params.page}
        size={params.size}
        onPage={(page) => update({ page })}
        onSize={(size) => update({ size })}
        filtered={filtered}
        onClearFilters={clearFilters}
        emptyTitle="No audit events yet"
        emptyDescription="Sign-ins and account changes are recorded here."
        toolbar={
          <TableToolbar
            search={params.q}
            searchLabel="Search action, subject, or ID"
            onSearch={(q) => update({ q })}
            filters={[
              {
                name: "outcome",
                label: "Outcome",
                value: outcome,
                options: outcomeOptions,
              },
            ]}
            onFilter={(name, value) => update({ filters: { [name]: value } })}
            count={
              total === undefined
                ? undefined
                : `${formatCount(total)} ${total === 1 ? "event" : "events"}${filtered ? " match" : ""}`
            }
          />
        }
      />
      <EntryDrawer entry={openEntry} onClose={() => setOpenEntry(null)} />
    </>
  );
}
