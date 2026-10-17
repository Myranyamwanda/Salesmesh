import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import * as scoringApi from "../../api/scoring";
import {
  BandBadge,
  ChartCard,
  DataTable,
  KpiCard,
  PageHeader,
  type DataColumn,
} from "../../components/DataComponents";
import type { AgentRanking } from "../../types/scoring";

const columns: DataColumn<AgentRanking>[] = [
  {
    key: "agent",
    label: "Agent",
    render: (row) => (
      <Link to={`/admin/agents/${row.id}`}>{row.display_name}</Link>
    ),
  },
  { key: "customers", label: "Customers", render: (row) => row.n_users },
  {
    key: "reputation",
    label: "Reputation",
    render: (row) => row.reputation.toFixed(1),
  },
  {
    key: "band",
    label: "Band",
    render: (row) => <BandBadge band={row.band} />,
  },
];

export function OverviewPage() {
  const modelQuery = useQuery({
    queryKey: ["admin", "model"],
    queryFn: scoringApi.getModel,
  });
  const queueQuery = useQuery({
    queryKey: ["admin", "review-queue", 0],
    queryFn: () => scoringApi.getReviewQueue(0, 25),
  });
  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: scoringApi.listAgents,
  });
  const agents = agentsQuery.data ?? [];
  // The ranking is already sorted by reputation, lowest first.
  const attention = agents
    .filter((agent) => agent.band !== "Low risk")
    .slice(0, 5);

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Overview"
        description="Model status, reviews waiting, and agents that need attention."
      />
      <section className="kpi-grid" aria-label="Workspace summary">
        <KpiCard
          label="Model"
          value={
            modelQuery.data
              ? modelQuery.data.status === "ok"
                ? "Ready"
                : "Failed"
              : null
          }
          detail={modelQuery.data?.model_version ?? undefined}
        />
        <KpiCard
          label="Reviews waiting"
          value={queueQuery.data?.total ?? null}
        />
        <KpiCard
          label="Agents"
          value={agentsQuery.data ? agents.length : null}
        />
        <KpiCard
          label="High-risk agents"
          value={
            agentsQuery.data
              ? agents.filter((agent) => agent.band === "High risk").length
              : null
          }
        />
      </section>
      <ChartCard
        title="Needs attention"
        description="The lowest-reputation agents that are not Low risk."
      >
        <DataTable
          columns={columns}
          rows={attention}
          rowKey={(row) => row.id}
          loading={agentsQuery.isPending}
          emptyLabel="No agents need attention."
        />
      </ChartCard>
    </>
  );
}
