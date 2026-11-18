import { useMemo, useState } from "react";
import { Alert, AlertTitle, Button } from "@mui/material";
import ArrowForward from "@mui/icons-material/ArrowForward";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { clientLabel } from "../../api/admin";
import * as scoringApi from "../../api/scoring";
import { PageError, PageHeader } from "../../components/DataComponents";
import {
  DetailDrawer,
  DetailSection,
} from "../../components/table/DetailDrawer";
import { ListTable, type ListColumn } from "../../components/table/ListTable";
import { BandStatus, StatusBadge } from "../../components/table/StatusBadge";
import { TableToolbar } from "../../components/table/TableToolbar";
import { useListParams } from "../../components/table/useListParams";
import type { AgentRanking } from "../../types/scoring";
import { formatCount, formatPercent } from "../../utils/format";

const sortKeys = ["display_name", "n_users", "flags", "reputation"] as const;
type SortKey = (typeof sortKeys)[number];

const bandOptions = [
  { value: "all", label: "All bands" },
  { value: "High risk", label: "High risk" },
  { value: "Watch", label: "Watch" },
  { value: "Low risk", label: "Low risk" },
  { value: "Insufficient data", label: "Insufficient data" },
];

function sortAgents(
  agents: AgentRanking[],
  key: SortKey,
  direction: "asc" | "desc",
) {
  const sign = direction === "asc" ? 1 : -1;
  return [...agents].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    const order =
      typeof left === "string"
        ? left.localeCompare(right as string)
        : (left as number) - (right as number);
    return sign * order;
  });
}

function NoSignals() {
  return (
    <span className="muted-dash">
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">None</span>
    </span>
  );
}

/** Admin-only warnings about an agent, as text badges. */
function Signals({ agent }: { agent: AgentRanking }) {
  if (!agent.assisted_alert && agent.link_active) return <NoSignals />;
  return (
    <span className="badge-stack">
      {agent.assisted_alert && (
        <StatusBadge tone="warning" label="High assisted share" />
      )}
      {!agent.link_active && (
        <StatusBadge tone="neutral" label="Link inactive" />
      )}
    </span>
  );
}

// The five values an admin compares across agents. Everything else about an
// agent is in the details drawer.
const columns: ListColumn<AgentRanking>[] = [
  {
    key: "display_name",
    label: "Agent",
    sortable: true,
    card: "title",
    render: (agent) => (
      <span className="cell-stack">
        <strong>{agent.display_name}</strong>
        <span>{agent.email}</span>
      </span>
    ),
  },
  {
    key: "n_users",
    label: "Customers",
    numeric: true,
    sortable: true,
    card: "stat",
    render: (agent) => formatCount(agent.n_users),
  },
  {
    key: "flags",
    label: "Flags",
    numeric: true,
    sortable: true,
    card: "stat",
    render: (agent) => formatCount(agent.flags),
  },
  {
    key: "reputation",
    label: "Reputation",
    numeric: true,
    sortable: true,
    card: "stat",
    render: (agent) => agent.reputation.toFixed(1),
  },
  {
    key: "band",
    label: "Band",
    card: "badge",
    render: (agent) => <BandStatus band={agent.band} />,
  },
  {
    key: "signals",
    label: "Signals",
    card: "extra",
    render: (agent) => <Signals agent={agent} />,
  },
];

function linkState(agent: AgentRanking) {
  if (agent.link_active) return "Active";
  return agent.client
    ? "Inactive: the client has no organisation name"
    : "Inactive: no client assigned";
}

function AgentDrawer({
  agent,
  onClose,
}: {
  agent: AgentRanking | null;
  onClose: () => void;
}) {
  return (
    <DetailDrawer
      open={agent !== null}
      onClose={onClose}
      title={agent?.display_name ?? ""}
      subtitle={agent?.email}
      badge={agent && <BandStatus band={agent.band} />}
      actions={
        agent && (
          <Button
            component={Link}
            to={`/admin/agents/${agent.id}`}
            variant="contained"
            endIcon={<ArrowForward />}
            fullWidth
          >
            Open agent detail
          </Button>
        )
      }
    >
      {agent && (
        <>
          <DetailSection
            title="Score"
            items={[
              {
                label: "Reputation",
                value: agent.reputation.toFixed(1),
                numeric: true,
              },
              {
                label: "Risk score",
                value: agent.risk_score.toFixed(1),
                numeric: true,
              },
            ]}
          />
          <DetailSection
            title="Customers"
            items={[
              {
                label: "Customers",
                value: formatCount(agent.n_users),
                numeric: true,
              },
              {
                label: "Flags",
                value: formatCount(agent.flags),
                numeric: true,
              },
              {
                label: "Confirmed fake",
                value: formatCount(agent.confirmed_fake),
                numeric: true,
              },
              {
                label: "Pending review",
                value: formatCount(agent.pending_review),
                numeric: true,
              },
              {
                label: "Assisted share",
                value: (
                  <span className="badge-stack">
                    {formatPercent(agent.assisted_share, 0)}
                    {agent.assisted_alert && (
                      <StatusBadge tone="warning" label="High assisted share" />
                    )}
                  </span>
                ),
              },
            ]}
          />
          <DetailSection
            title="Account"
            items={[
              {
                label: "Client",
                value: agent.client ? clientLabel(agent.client) : "No client",
              },
              { label: "Registration link", value: linkState(agent) },
              {
                label: "Referral code",
                value: <code className="code-text">{agent.referral_code}</code>,
              },
            ]}
          />
        </>
      )}
    </DetailDrawer>
  );
}

const listDefaults = {
  sort: "reputation",
  dir: "asc",
  filters: { band: "all" },
} as const;

export function AgentsPage() {
  const { params, update, filtered, clearFilters } =
    useListParams(listDefaults);
  const [openId, setOpenId] = useState<string | null>(null);
  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: scoringApi.listAgents,
  });
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const sortKey: SortKey = (sortKeys as readonly string[]).includes(params.sort)
    ? (params.sort as SortKey)
    : "reputation";
  const band = params.filters.band;

  // Phase 0 filters, sorts, and pages in the browser; Phase 1 moves this to
  // the API (offset/limit/total), and the table component stays the same.
  const matching = useMemo(() => {
    const term = params.q.trim().toLowerCase();
    return sortAgents(
      agents.filter(
        (agent) =>
          (band === "all" || agent.band === band) &&
          (!term ||
            agent.display_name.toLowerCase().includes(term) ||
            agent.email.toLowerCase().includes(term)),
      ),
      sortKey,
      params.dir,
    );
  }, [agents, band, params.q, params.dir, sortKey]);
  const lastPage = Math.max(1, Math.ceil(matching.length / params.size));
  const page = Math.min(params.page, lastPage);
  const rows = matching.slice((page - 1) * params.size, page * params.size);
  const withoutClient = agents.filter((agent) => agent.client === null);
  const openAgent = agents.find((agent) => agent.id === openId) ?? null;

  function changeSort(key: string) {
    if (key === sortKey) {
      update({ dir: params.dir === "asc" ? "desc" : "asc" });
    } else {
      update({ sort: key, dir: "asc" });
    }
  }

  const count = filtered
    ? `${formatCount(matching.length)} of ${formatCount(agents.length)} agents`
    : `${formatCount(agents.length)} agents`;

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Agents"
        description="Ranked by reputation, lowest first. Reputation is admin-only decision support and is never shown to agents."
      />
      {agentsQuery.isError && (
        <PageError
          message="Agents could not be loaded."
          error={agentsQuery.error}
        />
      )}
      {withoutClient.length > 0 && (
        <Alert severity="warning" className="page-notice">
          <AlertTitle>Agents without a client</AlertTitle>
          Their registration links are not active until you assign a client:{" "}
          {withoutClient.map((agent, index) => (
            <span key={agent.id}>
              {index > 0 && ", "}
              <Link to={`/admin/agents/${agent.id}`}>{agent.display_name}</Link>
            </span>
          ))}
          .
        </Alert>
      )}
      <ListTable
        label="Agents"
        columns={columns}
        rows={rows}
        rowKey={(agent) => agent.id}
        onOpen={(agent) => setOpenId(agent.id)}
        openKey={openId}
        loading={agentsQuery.isPending}
        total={matching.length}
        page={page}
        size={params.size}
        sort={sortKey}
        dir={params.dir}
        onSort={changeSort}
        onPage={(next) => update({ page: next })}
        onSize={(size) => update({ size })}
        filtered={filtered}
        onClearFilters={clearFilters}
        emptyTitle="No agents yet"
        emptyDescription="Agents appear here after they register and an admin approves them."
        toolbar={
          <TableToolbar
            search={params.q}
            searchLabel="Search agents"
            onSearch={(q) => update({ q })}
            filters={[
              {
                name: "band",
                label: "Band",
                value: band,
                options: bandOptions,
              },
            ]}
            onFilter={(name, value) => update({ filters: { [name]: value } })}
            count={agentsQuery.isPending ? undefined : count}
          />
        }
      />
      <AgentDrawer agent={openAgent} onClose={() => setOpenId(null)} />
    </>
  );
}
