import { useState } from "react";
import { Button, Typography } from "@mui/material";
import ArrowForward from "@mui/icons-material/ArrowForward";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import * as scoringApi from "../../api/scoring";
import {
  KpiCard,
  PageError,
  PageHeader,
} from "../../components/DataComponents";
import {
  DetailDrawer,
  DetailSection,
} from "../../components/table/DetailDrawer";
import { ListTable, type ListColumn } from "../../components/table/ListTable";
import { TableToolbar } from "../../components/table/TableToolbar";
import {
  pageOffset,
  useClampPage,
  useListParams,
} from "../../components/table/useListParams";
import type {
  EligibilityCounts,
  EligibilityReport,
  MonthEligibility,
} from "../../types/scoring";
import { formatCount } from "../../utils/format";

const ALL_TIME = "all";

type AgentRow = EligibilityReport["agents"][number];

function countColumns<Row>(
  counts: (row: Row) => EligibilityCounts,
): ListColumn<Row>[] {
  return [
    {
      key: "eligible",
      label: "Eligible",
      numeric: true,
      card: "stat",
      render: (row) => formatCount(counts(row).eligible),
    },
    {
      key: "pending",
      label: "Pending",
      numeric: true,
      card: "stat",
      render: (row) => formatCount(counts(row).pending),
    },
    {
      key: "not_eligible",
      label: "Not eligible",
      numeric: true,
      card: "stat",
      render: (row) => formatCount(counts(row).not_eligible),
    },
  ];
}

const monthColumns: ListColumn<MonthEligibility>[] = [
  { key: "month", label: "Month", card: "title", render: (row) => row.month },
  ...countColumns<MonthEligibility>((row) => row),
];

function agentColumns(
  counts: (row: AgentRow) => EligibilityCounts,
): ListColumn<AgentRow>[] {
  return [
    {
      key: "agent",
      label: "Agent",
      card: "title",
      render: (row) => (
        <span className="cell-stack">
          <strong>{row.agent.display_name}</strong>
        </span>
      ),
    },
    ...countColumns(counts),
  ];
}

function describe(counts: EligibilityCounts) {
  return `${formatCount(counts.eligible)} eligible · ${formatCount(counts.pending)} pending · ${formatCount(counts.not_eligible)} not eligible`;
}

function AgentDrawer({
  row,
  onClose,
}: {
  row: AgentRow | null;
  onClose: () => void;
}) {
  return (
    <DetailDrawer
      open={row !== null}
      onClose={onClose}
      title={row?.agent.display_name ?? ""}
      subtitle="Commission eligibility"
      actions={
        row && (
          <Button
            component={Link}
            to={`/admin/agents/${row.agent.id}`}
            variant="contained"
            endIcon={<ArrowForward />}
            fullWidth
          >
            Open agent detail
          </Button>
        )
      }
    >
      {row && (
        <>
          <DetailSection
            title="All time"
            items={[
              {
                label: "Eligible",
                value: formatCount(row.totals.eligible),
                numeric: true,
              },
              {
                label: "Pending",
                value: formatCount(row.totals.pending),
                numeric: true,
              },
              {
                label: "Not eligible",
                value: formatCount(row.totals.not_eligible),
                numeric: true,
              },
            ]}
          />
          <DetailSection
            title="By registration month"
            items={[...row.months].reverse().map((month) => ({
              label: month.month,
              value: describe(month),
            }))}
          />
        </>
      )}
    </DetailDrawer>
  );
}

const listDefaults = {
  sort: "display_name",
  dir: "asc",
  filters: { period: ALL_TIME },
} as const;

export function EligibilityPage() {
  const { params, update, filtered, clearFilters } =
    useListParams(listDefaults);
  const [openRow, setOpenRow] = useState<AgentRow | null>(null);
  const period = params.filters.period;
  const reportQuery = useQuery({
    queryKey: ["admin", "eligibility", params.page, params.size, params.q],
    queryFn: () =>
      scoringApi.getEligibility({
        offset: pageOffset(params),
        limit: params.size,
        q: params.q.trim(),
      }),
    placeholderData: keepPreviousData,
  });
  const report = reportQuery.data;
  const total = report?.agents_total;
  useClampPage(total, params, update);
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
        <PageError
          message="Commission eligibility could not be loaded."
          error={reportQuery.error}
        />
      )}
      <section className="kpi-grid" aria-label="Eligibility totals">
        <KpiCard
          label="Eligible"
          value={report ? formatCount(report.totals.eligible) : null}
          detail="Clear or verified"
        />
        <KpiCard
          label="Pending"
          value={report ? formatCount(report.totals.pending) : null}
          detail="Waiting for a review decision"
        />
        <KpiCard
          label="Not eligible"
          value={report ? formatCount(report.totals.not_eligible) : null}
          detail="Confirmed fake"
        />
      </section>
      <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>
        By registration month
      </Typography>
      <ListTable
        label="Eligibility by registration month"
        columns={monthColumns}
        rows={months}
        rowKey={(row) => row.month}
        loading={reportQuery.isPending}
        emptyTitle="No registrations yet"
      />
      <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>
        By agent
      </Typography>
      <ListTable
        label="Eligibility by agent"
        columns={agentColumns(counts)}
        rows={report?.agents ?? []}
        rowKey={(row) => row.agent.id}
        onOpen={setOpenRow}
        href={(row) => `/admin/agents/${row.agent.id}`}
        openKey={openRow?.agent.id}
        loading={reportQuery.isPending}
        total={total ?? 0}
        page={params.page}
        size={params.size}
        onPage={(page) => update({ page })}
        onSize={(size) => update({ size })}
        filtered={filtered}
        onClearFilters={clearFilters}
        emptyTitle="No agents yet"
        toolbar={
          <TableToolbar
            search={params.q}
            searchLabel="Search agents"
            onSearch={(q) => update({ q })}
            filters={[
              {
                name: "period",
                label: "Period",
                value: period,
                options: [
                  { value: ALL_TIME, label: "All time" },
                  ...months.map((month) => ({
                    value: month.month,
                    label: month.month,
                  })),
                ],
              },
            ]}
            onFilter={(name, value) => update({ filters: { [name]: value } })}
            count={
              total === undefined
                ? undefined
                : `${formatCount(total)} ${total === 1 ? "agent" : "agents"}${params.q.trim() ? " match" : ""}`
            }
          />
        }
      />
      <AgentDrawer row={openRow} onClose={() => setOpenRow(null)} />
    </>
  );
}
