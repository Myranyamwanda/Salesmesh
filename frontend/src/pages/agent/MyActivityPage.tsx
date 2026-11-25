import { Paper, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import * as portalApi from "../../api/portal";
import { PageError, PageHeader } from "../../components/DataComponents";
import { ListTable, type ListColumn } from "../../components/table/ListTable";
import type { MonthActivity, Standing } from "../../types/scoring";
import { formatCount, formatLongDate } from "../../utils/format";

// Agents see one label and monthly totals only; scores, bands, and customer
// statuses are admin-only (docs/reputation-and-review.md, "Agent Standing").
const explanations: Record<Standing["standing"], string> = {
  "New agent":
    "Your standing appears once enough customers have registered through your link.",
  "Good standing":
    "Thank you. Keep registering customers through your link as you do now.",
  "Account under review":
    "An administrator is looking at the registrations made through your link. Your link keeps working and nothing changes automatically. An administrator may contact you to ask about your registrations; you can also contact your administrator.",
};

const HIDDEN = "Shown from 10 registrations";

const hiddenOr = (value: number | null) =>
  value === null ? (
    <span className="muted-dash">{HIDDEN}</span>
  ) : (
    formatCount(value)
  );

// Twelve fixed months: a report, so no search, pager, or details.
const columns: ListColumn<MonthActivity>[] = [
  { key: "month", label: "Month", card: "title", render: (row) => row.month },
  {
    key: "registrations",
    label: "Registrations",
    numeric: true,
    card: "stat",
    render: (row) => formatCount(row.registrations),
  },
  {
    key: "eligible",
    label: "Eligible",
    numeric: true,
    card: "stat",
    render: (row) => hiddenOr(row.eligible),
  },
  {
    key: "awaiting",
    label: "Awaiting verification",
    numeric: true,
    card: "stat",
    render: (row) => hiddenOr(row.awaiting_verification),
  },
];

export function MyActivityPage() {
  const standingQuery = useQuery({
    queryKey: ["me", "standing"],
    queryFn: portalApi.getMyStanding,
  });
  const activityQuery = useQuery({
    queryKey: ["me", "activity"],
    queryFn: portalApi.getMyActivity,
  });
  const standing = standingQuery.data;
  // Newest month first for reading.
  const months = [...(activityQuery.data?.months ?? [])].reverse();

  return (
    <>
      <PageHeader
        eyebrow="AGENT WORKSPACE"
        title="My activity"
        description="Your standing and your monthly totals. Both are updated at the start of each month and cover completed months only."
      />
      {(standingQuery.isError || activityQuery.isError) && (
        <PageError
          message="Your activity could not be loaded."
          error={standingQuery.error ?? activityQuery.error}
        />
      )}
      <Paper
        className="chart-card"
        variant="outlined"
        square
        aria-label="My standing"
        component="section"
      >
        <Typography color="text.secondary">My standing</Typography>
        <Typography component="p" variant="h5" sx={{ my: 1 }}>
          {standing?.standing ?? "…"}
        </Typography>
        {standing && (
          <>
            <Typography>{explanations[standing.standing]}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              As of {formatLongDate(standing.as_of)}.
            </Typography>
          </>
        )}
      </Paper>
      <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>
        Monthly totals
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1 }}>
        Eligible registrations may count towards your commission. Awaiting
        verification means a check is not finished yet. For a month with fewer
        than 10 registrations only the total is shown.
      </Typography>
      <ListTable
        label="Monthly totals"
        columns={columns}
        rows={months}
        rowKey={(row) => row.month}
        loading={activityQuery.isPending}
        emptyTitle="No completed months yet"
        emptyDescription="Your totals appear at the start of the month after your first registration."
      />
    </>
  );
}
