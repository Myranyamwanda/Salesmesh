import { useState } from "react";
import {
  Alert,
  AlertTitle,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { clientLabel } from "../../api/admin";
import * as scoringApi from "../../api/scoring";
import {
  BandBadge,
  PageError,
  PageFilters,
  PageHeader,
} from "../../components/DataComponents";
import type { AgentRanking } from "../../types/scoring";
import { formatPercent } from "../../utils/format";

type SortKey =
  | "display_name"
  | "n_users"
  | "flags"
  | "confirmed_fake"
  | "pending_review"
  | "assisted_share"
  | "reputation";

const sortable: { key: SortKey; label: string }[] = [
  { key: "display_name", label: "Agent" },
  { key: "n_users", label: "Customers" },
  { key: "flags", label: "Flags" },
  { key: "confirmed_fake", label: "Confirmed fake" },
  { key: "pending_review", label: "Pending" },
  { key: "assisted_share", label: "Assisted share" },
  { key: "reputation", label: "Reputation" },
];

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

export function AgentsPage() {
  const [sortKey, setSortKey] = useState<SortKey>("reputation");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [band, setBand] = useState("all");
  const [search, setSearch] = useState("");
  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: scoringApi.listAgents,
  });

  function changeSort(key: SortKey) {
    if (key === sortKey) {
      setDirection(direction === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  const withoutClient = (agentsQuery.data ?? []).filter(
    (agent) => agent.client === null,
  );
  const term = search.trim().toLowerCase();
  const rows = sortAgents(
    (agentsQuery.data ?? []).filter(
      (agent) =>
        (band === "all" || agent.band === band) &&
        (!term ||
          agent.display_name.toLowerCase().includes(term) ||
          agent.email.toLowerCase().includes(term)),
    ),
    sortKey,
    direction,
  );

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Agents"
        description="Agents ranked by reputation, lowest first. Reputation is a decision-support score from flagged and confirmed-fake customers; it is never shown to agents."
      />
      <PageFilters
        search={search}
        onSearch={setSearch}
        searchLabel="Search agents"
        filterLabel="Band"
        filterValue={band}
        filterOptions={bandOptions}
        onFilter={setBand}
      />
      {agentsQuery.isError && (
        <PageError message="Agents could not be loaded." />
      )}
      {withoutClient.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
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
      <TableContainer
        component={Paper}
        variant="outlined"
        square
        className="data-table-wrap"
      >
        <Table size="small" aria-label="Agents ranking">
          <TableHead>
            <TableRow>
              {sortable.map(({ key, label }) => (
                <TableCell
                  key={key}
                  sortDirection={sortKey === key ? direction : false}
                >
                  <TableSortLabel
                    active={sortKey === key}
                    direction={sortKey === key ? direction : "asc"}
                    onClick={() => changeSort(key)}
                  >
                    {label}
                  </TableSortLabel>
                </TableCell>
              ))}
              <TableCell>Risk score</TableCell>
              <TableCell>Band</TableCell>
              <TableCell>Client</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((agent) => (
              <TableRow hover key={agent.id}>
                <TableCell>
                  <Link to={`/admin/agents/${agent.id}`}>
                    {agent.display_name}
                  </Link>
                </TableCell>
                <TableCell>{agent.n_users}</TableCell>
                <TableCell>{agent.flags}</TableCell>
                <TableCell>{agent.confirmed_fake}</TableCell>
                <TableCell>{agent.pending_review}</TableCell>
                <TableCell>{formatPercent(agent.assisted_share, 0)}</TableCell>
                <TableCell>{agent.reputation.toFixed(1)}</TableCell>
                <TableCell>{agent.risk_score.toFixed(1)}</TableCell>
                <TableCell>
                  <BandBadge band={agent.band} />
                </TableCell>
                <TableCell>
                  {agent.client ? clientLabel(agent.client) : "No client"}
                  {!agent.link_active && (
                    <Chip
                      size="small"
                      variant="outlined"
                      color="warning"
                      label="Link inactive"
                      sx={{ ml: 1 }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!agentsQuery.isPending && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10}>
                  <div className="table-empty">No agents match.</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
