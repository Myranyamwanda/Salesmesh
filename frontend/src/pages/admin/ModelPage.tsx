import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import Refresh from "@mui/icons-material/Refresh";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as scoringApi from "../../api/scoring";
import {
  KpiCard,
  PageError,
  PageHeader,
} from "../../components/DataComponents";
import { apiErrorMessage } from "../../utils/errors";
import { formatDateTime, formatPercent } from "../../utils/format";

export function ModelPage() {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const modelQuery = useQuery({
    queryKey: ["admin", "model"],
    queryFn: scoringApi.getModel,
  });
  const reloadMutation = useMutation({
    mutationFn: scoringApi.reloadModel,
    onSuccess: (model) => queryClient.setQueryData(["admin", "model"], model),
    onSettled: () => setConfirmOpen(false),
  });
  const model = modelQuery.data;
  const golden = model?.golden_check;

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Model"
        description="The fraud model in use, its test results, and its startup checks."
        action={
          <Button
            variant="contained"
            startIcon={<Refresh />}
            onClick={() => setConfirmOpen(true)}
          >
            Reload model
          </Button>
        }
      />
      {modelQuery.isError && (
        <PageError message="The model status could not be loaded." />
      )}
      {reloadMutation.isSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Model reloaded and checked.
        </Alert>
      )}
      {reloadMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {apiErrorMessage(reloadMutation.error, "The model was not reloaded.")}
        </Alert>
      )}
      {model && (
        <>
          {model.status === "failed" && (
            <Alert severity="error" sx={{ mb: 2 }}>
              The model is not available: {model.error}
            </Alert>
          )}
          <section className="kpi-grid" aria-label="Model summary">
            <KpiCard
              label="Status"
              value={model.status === "ok" ? "Ready" : "Failed"}
              detail={
                model.loaded_at
                  ? `Loaded ${formatDateTime(model.loaded_at)}`
                  : undefined
              }
            />
            <KpiCard
              label="Version"
              value={model.model_version}
              detail={model.model_name ?? undefined}
            />
            <KpiCard
              label="Threshold"
              value={
                model.threshold === null ? null : formatPercent(model.threshold)
              }
              detail="Flag when the probability is at or above this"
            />
            <KpiCard
              label="Golden check"
              value={golden ? (golden.passed ? "Passed" : "Failed") : null}
              detail={
                golden
                  ? `${golden.checked - golden.failed} of ${golden.checked} within ${golden.tolerance} (largest difference ${golden.max_difference.toExponential(1)})`
                  : "Not run"
              }
            />
          </section>
          <Paper className="chart-card" variant="outlined" square>
            <Typography component="h2" variant="h6" gutterBottom>
              Details
            </Typography>
            <dl className="detail-grid">
              <div>
                <dt>Model type</dt>
                <dd>{model.model_type ?? "—"}</dd>
              </div>
              <div>
                <dt>scikit-learn</dt>
                <dd>{model.sklearn_version ?? "—"}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{model.source}</dd>
              </div>
              <div>
                <dt>Startup check</dt>
                <dd>
                  <Chip
                    size="small"
                    label={
                      golden?.passed ? "Golden examples passed" : "Not passed"
                    }
                    color={golden?.passed ? "success" : "error"}
                  />
                </dd>
              </div>
            </dl>
            <Typography component="h2" variant="h6" gutterBottom>
              Test metrics
            </Typography>
            <Table size="small" aria-label="Test metrics">
              <TableHead>
                <TableRow>
                  <TableCell>Metric</TableCell>
                  <TableCell>Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(model.metrics).map(([name, value]) => (
                  <TableRow key={name}>
                    <TableCell>{name}</TableCell>
                    <TableCell>
                      {Number.isInteger(value) ? value : value.toFixed(4)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Reload the model?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The model files are loaded again and checked. If the check fails,
            the current model stays in use.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={reloadMutation.isPending}
            onClick={() => reloadMutation.mutate()}
          >
            {reloadMutation.isPending ? "Reloading…" : "Reload"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
