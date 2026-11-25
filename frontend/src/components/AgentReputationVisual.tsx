import { useQuery } from "@tanstack/react-query";
import * as scoringApi from "../api/scoring";
import type { AgentRanking } from "../types/scoring";
import { ReputationGauge, ReputationTrend } from "./VisualIdentity";

export function AgentReputationVisual({
  agent,
  large = false,
}: {
  agent: AgentRanking;
  large?: boolean;
}) {
  const kpisQuery = useQuery({
    queryKey: ["admin", "agent-kpis", agent.id],
    queryFn: () => scoringApi.getAgentKpis(agent.id),
    staleTime: 5 * 60 * 1000,
  });
  const values = kpisQuery.data?.months
    .slice(-6)
    .map((month) => month.reputation);
  return (
    <span
      className={`identity-agent-reputation${large ? " identity-agent-reputation-large" : ""}`}
    >
      <ReputationGauge
        value={agent.reputation}
        band={agent.band}
        size={large ? "large" : "regular"}
      />
      {kpisQuery.isPending ? (
        <span className="identity-trend-empty">Loading trend…</span>
      ) : kpisQuery.isError ? (
        <span className="identity-trend-empty">Trend unavailable</span>
      ) : (
        <ReputationTrend name={agent.display_name} values={values ?? []} />
      )}
    </span>
  );
}
