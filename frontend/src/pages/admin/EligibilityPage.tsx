import { useState } from "react";
import { MenuItem, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import * as scoringApi from "../../api/scoring";
import {
  DataTable,
  KpiCard,
  PageError,
  PageHeader,
  type DataColumn,
} from "../../components/DataComponents";
import type {
  EligibilityCounts,
  EligibilityReport,
  MonthEligibility,
} from "../../types/scoring";

const ALL_TIME = "all";

type AgentRow = EligibilityReport["agents"][number];

const monthColumns: DataColumn<MonthEligibility>[] = [
  { key: "month", label: "Month", render: (row) => row.month },
  { key: "eligible", label: "Eligible", render: (row) => row.eligible },
  { key: "pending", label: "Pending", render: (row) => row.pending },
  {
    key: "not_eligible",
    label: "Not eligible",
    render: (row) => row.not_eligible,
  },
];

function agentColumns(
  counts: (row: AgentRow) => EligibilityCounts,
): DataColumn<AgentRow>[] {
  return [
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
      key: "eligible",
      label: "Eligible",
      render: (row) => counts(row).eligible,
    },
    { key: "pending", label: "Pending", render: (row) => counts(row).pending },
    {
      key: "not_eligible",
      label: "Not eligible",
      render: (row) => counts(row).not_eligible,
    },
  ];
}

export function EligibilityPage() {
  const [period, setPeriod] = useState(ALL_TIME);
  const reportQuery = useQuery({
    queryKey: ["admin", "eligibility"],
    queryFn: scoringApi.getEligibility,
  });
  const report = reportQuery.data;
  // Newest month first for reading; the API sends oldest first.
  const months = [...(report?.months ?? [])].reverse();
  const counts = (row: AgentRow) =>
    period === ALL_TIME
      ? row.totals
      : (row.months.find((month) => month.month === period) ?? row.totals);

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Commission eligibility"
        description="Which registrations may count towards an agent's commission. Clear and verified registrations are eligible, flagged ones are pending until a reviewer decides, and confirmed fakes are not eligible. SalesMesh provides this input only; amounts and payouts belong to the commission module."
      />
      {reportQuery.isError && (
        <PageError message="Commission eligibility could not be loaded." />
      )}
      <section className="kpi-grid" aria-label="Eligibility totals">
        <KpiCard
          label="Eligible"
          value={report?.totals.eligible ?? null}
          detail="Clear or verified"
        />
        <KpiCard
          label="Pending"
          value={report?.totals.pending ?? null}
          detail="Waiting for a review decision"
        />
        <KpiCard
          label="Not eligible"
          value={report?.totals.not_eligible ?? null}
          detail="Confirmed fake"
        />
      </section>
      <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>
        By registration month
      </Typography>
      <DataTable
        columns={monthColumns}
        rows={months}
        rowKey={(row) => row.month}
        loading={reportQuery.isPending}
        emptyLabel="No registrations yet."
      />
      <div className="page-toolbar" style={{ marginTop: 24 }}>
        <Typography component="h2" variant="h6">
          By agent
        </Typography>
        <TextField
          select
          size="small"
          label="Period"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value={ALL_TIME}>All time</MenuItem>
          {months.map((month) => (
            <MenuItem key={month.month} value={month.month}>
              {month.month}
            </MenuItem>
          ))}
        </TextField>
      </div>
      <DataTable
        columns={agentColumns(counts)}
        rows={report?.agents ?? []}
        rowKey={(row) => row.agent.id}
        loading={reportQuery.isPending}
        emptyLabel="No agents yet."
      />
    </>
  );
}
