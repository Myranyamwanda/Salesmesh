import { useState } from "react";
import { Button, TablePagination } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import * as scoringApi from "../../api/scoring";
import {
  DataTable,
  PageError,
  PageHeader,
  type DataColumn,
} from "../../components/DataComponents";
import { ReasonList, ReviewDialog } from "../../components/ReviewDialog";
import type { QueueItem } from "../../types/scoring";
import { formatDateTime, formatPercent } from "../../utils/format";

const PAGE_SIZE = 25;

export function ReviewQueuePage() {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const queueQuery = useQuery({
    queryKey: ["admin", "review-queue", page],
    queryFn: () => scoringApi.getReviewQueue(page * PAGE_SIZE, PAGE_SIZE),
  });

  const columns: DataColumn<QueueItem>[] = [
    {
      key: "date",
      label: "Registered",
      render: (row) => formatDateTime(row.created_at),
    },
    { key: "customer", label: "Customer", render: (row) => row.customer_name },
    {
      key: "agent",
      label: "Agent",
      render: (row) => (
        <Link to={`/admin/agents/${row.agent.id}`}>
          {row.agent.display_name}
        </Link>
      ),
    },
    {
      key: "probability",
      label: "Probability",
      render: (row) => formatPercent(row.probability),
    },
    {
      key: "reasons",
      label: "Top reasons",
      render: (row) => <ReasonList reasons={row.reasons} />,
    },
    {
      key: "action",
      label: "",
      render: (row) => (
        <Button size="small" onClick={() => setSelected(row.assessment_id)}>
          Review
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Review queue"
        description="Flagged registrations waiting for a decision, oldest first. A Rule reason came from a fixed rule; a Model reason from the fraud model."
      />
      {queueQuery.isError && (
        <PageError message="The review queue could not be loaded." />
      )}
      <DataTable
        columns={columns}
        rows={queueQuery.data?.items ?? []}
        rowKey={(row) => row.assessment_id}
        loading={queueQuery.isPending}
        emptyLabel="Nothing to review. Flagged registrations will appear here."
      />
      <TablePagination
        component="div"
        count={queueQuery.data?.total ?? 0}
        page={page}
        onPageChange={(_, next) => setPage(next)}
        rowsPerPage={PAGE_SIZE}
        rowsPerPageOptions={[PAGE_SIZE]}
      />
      <ReviewDialog assessmentId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
