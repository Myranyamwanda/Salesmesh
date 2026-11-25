import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import * as scoringApi from "../../api/scoring";
import {
  PageError,
  PageHeader,
  SourceChip,
} from "../../components/DataComponents";
import { ReviewDialog } from "../../components/ReviewDialog";
import { ListTable, type ListColumn } from "../../components/table/ListTable";
import { TableToolbar } from "../../components/table/TableToolbar";
import { ProbabilityMeter } from "../../components/VisualIdentity";
import {
  pageOffset,
  useClampPage,
  useListParams,
} from "../../components/table/useListParams";
import type { QueueItem } from "../../types/scoring";
import { formatCount, formatDateTime } from "../../utils/format";

const kindOptions = [
  { value: "all", label: "Flags and audits" },
  { value: "flag", label: "Flags only" },
  { value: "audit", label: "Random audits only" },
];

/** Model, Rule, or Audit, once each, in the order of the reasons. */
function Sources({ row }: { row: QueueItem }) {
  const sources = [...new Set(row.reasons.map((reason) => reason.source))];
  return (
    <span className="badge-stack">
      {sources.map((source) => (
        <SourceChip key={source} source={source} />
      ))}
    </span>
  );
}

const columns: ListColumn<QueueItem>[] = [
  {
    key: "customer",
    label: "Customer",
    card: "title",
    render: (row) => (
      <span className="cell-stack">
        <strong>{row.customer_name}</strong>
      </span>
    ),
  },
  {
    key: "agent",
    label: "Agent",
    card: "extra",
    render: (row) => (
      <Link to={`/admin/agents/${row.agent.id}`}>{row.agent.display_name}</Link>
    ),
  },
  {
    key: "date",
    label: "Registered",
    card: "stat",
    render: (row) => formatDateTime(row.created_at),
  },
  {
    key: "probability",
    label: "Probability",
    numeric: true,
    card: "stat",
    render: (row) => <ProbabilityMeter value={row.probability} />,
  },
  {
    key: "source",
    label: "Source",
    card: "badge",
    render: (row) => <Sources row={row} />,
  },
  {
    key: "reason",
    label: "Top reason",
    hideBelow: 1280,
    render: (row) => (
      <span className="cell-clamp">{row.reasons[0]?.text ?? "—"}</span>
    ),
  },
];

const listDefaults = {
  sort: "created_at",
  dir: "asc",
  filters: { kind: "all" },
} as const;

export function ReviewQueuePage() {
  const { params, update, filtered, clearFilters } =
    useListParams(listDefaults);
  const [selected, setSelected] = useState<string | null>(null);
  const kind = params.filters.kind;
  const queueQuery = useQuery({
    queryKey: ["admin", "review-queue", params],
    queryFn: () =>
      scoringApi.getReviewQueue({
        offset: pageOffset(params),
        limit: params.size,
        q: params.q.trim(),
        kind: kind === "flag" || kind === "audit" ? kind : undefined,
      }),
    placeholderData: keepPreviousData,
  });
  const total = queueQuery.data?.total;
  useClampPage(total, params, update);

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Review queue"
        description="Flagged registrations and random audits waiting for a decision, oldest first. A Rule reason came from a fixed rule, a Model reason from the fraud model, and an Audit is a random check of an assisted registration, not a flag."
      />
      {queueQuery.isError && (
        <PageError
          message="The review queue could not be loaded."
          error={queueQuery.error}
        />
      )}
      <ListTable
        label="Review queue"
        columns={columns}
        rows={queueQuery.data?.items ?? []}
        rowKey={(row) => row.assessment_id}
        // The review dialog is this list's details view.
        onOpen={(row) => setSelected(row.assessment_id)}
        openKey={selected}
        loading={queueQuery.isPending}
        total={total ?? 0}
        page={params.page}
        size={params.size}
        onPage={(page) => update({ page })}
        onSize={(size) => update({ size })}
        filtered={filtered}
        onClearFilters={clearFilters}
        emptyTitle="Nothing to review"
        emptyDescription="Flagged registrations and random audits will appear here."
        toolbar={
          <TableToolbar
            search={params.q}
            searchLabel="Search customer or agent"
            onSearch={(q) => update({ q })}
            filters={[
              {
                name: "kind",
                label: "Show",
                value: kind,
                options: kindOptions,
              },
            ]}
            onFilter={(name, value) => update({ filters: { [name]: value } })}
            count={
              total === undefined
                ? undefined
                : `${formatCount(total)} waiting${filtered ? " (filtered)" : ""}`
            }
          />
        }
      />
      <ReviewDialog assessmentId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
