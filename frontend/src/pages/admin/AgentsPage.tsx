import { useState } from "react";
import { Alert, AlertTitle, Button } from "@mui/material";
import ArrowForward from "@mui/icons-material/ArrowForward";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import {
  pageOffset,
  useClampPage,
  useListParams,
} from "../../components/table/useListParams";
import type { AgentRanking, Band } from "../../types/scoring";
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

const reviewOptions = [
  { value: "all", label: "All agents" },
  { value: "pending", label: "Has pending reviews" },
];

const clientOptions = [
  { value: "all", label: "Any client" },
  { value: "none", label: "No client" },
];

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

/** "12 · 3 pending": flags, and how many of them wait for a review. */
function Flags({ agent }: { agent: AgentRanking }) {
  return (
    <>
      {formatCount(agent.flags)}
      {agent.pending_review > 0 && (
        <span className="cell-note">
          {" "}
          · {formatCount(agent.pending_review)} pending
        </span>
      )}
    </>
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
    render: (agent) => <Flags agent={agent} />,
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
  filters: { band: "all", reviews: "all", client: "all" },
} as const;

/** Up to this many names in the "without a client" notice. */
const NOTICE_NAMES = 5;

function WithoutClientNotice({ onShow }: { onShow: () => void }) {
  const query = useQuery({
    queryKey: ["admin", "agents", "without-client"],
    queryFn: () =>
      scoringApi.listAgents({
        offset: 0,
        limit: NOTICE_NAMES,
        no_client: true,
        sort: "display_name",
      }),
  });
  const page = query.data;
  if (!page?.total) return null;
  const more = page.total - page.items.length;
  return (
    <Alert
      severity="warning"
      className="page-notice"
      action={
        <Button color="inherit" size="small" onClick={onShow}>
          Show them
        </Button>
      }
    >
      <AlertTitle>Agents without a client</AlertTitle>
      Their registration links are not active until you assign a client:{" "}
      {page.items.map((agent, index) => (
        <span key={agent.id}>
          {index > 0 && ", "}
          <Link to={`/admin/agents/${agent.id}`}>{agent.display_name}</Link>
        </span>
      ))}
      {more > 0 && ` and ${formatCount(more)} more`}.
    </Alert>
  );
}

export function AgentsPage() {
  const { params, update, filtered, clearFilters } =
    useListParams(listDefaults);
  const [openAgent, setOpenAgent] = useState<AgentRanking | null>(null);
  const sortKey: SortKey = (sortKeys as readonly string[]).includes(params.sort)
    ? (params.sort as SortKey)
    : "reputation";
  const { band, reviews, client } = params.filters;
  const agentsQuery = useQuery({
    queryKey: ["admin", "agents", "list", params],
    queryFn: () =>
      scoringApi.listAgents({
        offset: pageOffset(params),
        limit: params.size,
        q: params.q.trim(),
        sort: sortKey,
        dir: params.dir,
        band: band === "all" ? [] : [band as Band],
        has_pending: reviews === "pending",
        no_client: client === "none",
      }),
    // Keep the current rows on screen while the next page loads.
    placeholderData: keepPreviousData,
  });
  const total = agentsQuery.data?.total;
  useClampPage(total, params, update);

  function changeSort(key: string) {
    if (key === sortKey) {
      update({ dir: params.dir === "asc" ? "desc" : "asc" });
    } else {
      update({ sort: key, dir: "asc" });
    }
  }

  const count =
    total === undefined
      ? undefined
      : `${formatCount(total)} ${total === 1 ? "agent" : "agents"}${filtered ? " match" : ""}`;

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
      <WithoutClientNotice
        onShow={() =>
          update({
            q: "",
            filters: { band: "all", reviews: "all", client: "none" },
          })
        }
      />
      <ListTable
        label="Agents"
        columns={columns}
        rows={agentsQuery.data?.items ?? []}
        rowKey={(agent) => agent.id}
        onOpen={setOpenAgent}
        href={(agent) => `/admin/agents/${agent.id}`}
        openKey={openAgent?.id}
        loading={agentsQuery.isPending}
        total={total ?? 0}
        page={params.page}
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
              {
                name: "reviews",
                label: "Reviews",
                value: reviews,
                options: reviewOptions,
              },
              {
                name: "client",
                label: "Client",
                value: client,
                options: clientOptions,
              },
            ]}
            onFilter={(name, value) => update({ filters: { [name]: value } })}
            count={count}
          />
        }
      />
      <AgentDrawer agent={openAgent} onClose={() => setOpenAgent(null)} />
    </>
  );
}
