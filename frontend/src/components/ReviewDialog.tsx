import { useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as scoringApi from "../api/scoring";
import type { Decision, Reason } from "../types/scoring";
import { apiErrorMessage } from "../utils/errors";
import { formatDate, formatDateTime, formatPercent } from "../utils/format";
import { SourceChip, StatusChip } from "./DataComponents";

// Plain names for the 13 stored feature values.
const FEATURE_LABELS: Record<string, string> = {
  name_email_similarity: "Name and email similarity",
  prev_address_months_count: "Months at previous address",
  current_address_months_count: "Months at current address",
  date_of_birth_distinct_emails_4w: "Emails with same date of birth (4 weeks)",
  email_is_free: "Free email provider",
  phone_home_valid: "Valid secondary phone",
  phone_mobile_valid: "Valid mobile phone",
  foreign_request: "Request from another country",
  source: "Source",
  session_length_in_minutes: "Minutes on the form",
  device_os: "Device operating system",
  keep_alive_session: "Kept signed in",
  device_distinct_emails_8w: "Emails from this device (8 weeks)",
};

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  if (!reasons.length) {
    return <Typography color="text.secondary">No reasons recorded.</Typography>;
  }
  return (
    <ul className="reason-list">
      {reasons.map((reason) => (
        <li key={reason.code}>
          <SourceChip source={reason.source} />
          <span>{reason.text}</span>
        </li>
      ))}
    </ul>
  );
}

function displayValue(value: string | number | null) {
  if (value === null) return "Missing";
  if (typeof value === "number" && !Number.isInteger(value))
    return value.toFixed(3);
  return String(value);
}

export function ReviewDialog({
  assessmentId,
  onClose,
}: {
  assessmentId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const assessmentQuery = useQuery({
    queryKey: ["admin", "assessment", assessmentId],
    queryFn: () => scoringApi.getAssessment(assessmentId as string),
    enabled: assessmentId !== null,
  });
  const reviewMutation = useMutation({
    mutationFn: (decision: Decision) =>
      scoringApi.reviewAssessment(assessmentId as string, decision, notes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      setNotes("");
      onClose();
    },
  });
  const assessment = assessmentQuery.data;

  return (
    <Dialog
      open={assessmentId !== null}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="review-title"
    >
      <DialogTitle id="review-title">Review registration</DialogTitle>
      <DialogContent dividers>
        {assessmentQuery.isPending && (
          <CircularProgress aria-label="Loading assessment" />
        )}
        {assessmentQuery.isError && (
          <Alert severity="error">The assessment could not be loaded.</Alert>
        )}
        {assessment && (
          <>
            <dl className="detail-grid">
              <div>
                <dt>Customer</dt>
                <dd>{assessment.customer.full_name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{assessment.customer.email}</dd>
              </div>
              <div>
                <dt>Mobile</dt>
                <dd>{assessment.customer.mobile_phone}</dd>
              </div>
              <div>
                <dt>Date of birth</dt>
                <dd>{formatDate(assessment.customer.date_of_birth)}</dd>
              </div>
              <div>
                <dt>Agent</dt>
                <dd>{assessment.agent.display_name}</dd>
              </div>
              <div>
                <dt>Registered</dt>
                <dd>
                  {formatDateTime(assessment.customer.created_at)}
                  {assessment.customer.assisted && " (assisted)"}
                </dd>
              </div>
              <div>
                <dt>Probability of a fake customer</dt>
                <dd>
                  {formatPercent(assessment.probability)} (threshold{" "}
                  {formatPercent(assessment.threshold)})
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusChip status={assessment.customer.status} />
                </dd>
              </div>
            </dl>
            <Typography component="h3" variant="subtitle1" gutterBottom>
              Reasons
            </Typography>
            <ReasonList reasons={assessment.reasons} />
            <Typography
              component="h3"
              variant="subtitle1"
              sx={{ mt: 2 }}
              gutterBottom
            >
              Feature values (as registered)
            </Typography>
            <Table size="small" aria-label="Feature values">
              <TableBody>
                {Object.entries(assessment.features).map(([name, value]) => (
                  <TableRow key={name}>
                    <TableCell>{FEATURE_LABELS[name] ?? name}</TableCell>
                    <TableCell>{displayValue(value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {assessment.review ? (
              <Alert severity="info" sx={{ mt: 2 }}>
                Already reviewed:{" "}
                {assessment.review.decision === "confirmed_fake"
                  ? "confirmed fake"
                  : "confirmed real"}{" "}
                on {formatDateTime(assessment.review.created_at)}
                {assessment.review.notes && ` — ${assessment.review.notes}`}
              </Alert>
            ) : (
              <TextField
                sx={{ mt: 2 }}
                label="Notes (optional)"
                multiline
                minRows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 1000 } }}
              />
            )}
            {reviewMutation.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {apiErrorMessage(
                  reviewMutation.error,
                  "The review could not be saved.",
                )}
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {assessment && !assessment.review && (
          <>
            <Button
              color="success"
              variant="outlined"
              disabled={reviewMutation.isPending}
              onClick={() => reviewMutation.mutate("confirmed_real")}
            >
              Confirm real
            </Button>
            <Button
              color="error"
              variant="contained"
              disabled={reviewMutation.isPending}
              onClick={() => reviewMutation.mutate("confirmed_fake")}
            >
              Confirm fake
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
