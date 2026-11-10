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
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as scoringApi from "../api/scoring";
import type { Decision, FeatureEffect, Reason } from "../types/scoring";
import { apiErrorMessage } from "../utils/errors";
import { formatDate, formatDateTime, formatPercent } from "../utils/format";
import { PageError, SourceChip, StatusChip } from "./DataComponents";
import { EraseCustomerDialog } from "./EraseCustomerDialog";

// Plain names for the stored feature values. name_email_similarity and
// keep_alive_session appear only in snapshots scored by model v1 (history).
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

const EFFECT_LABELS: Record<FeatureEffect, string> = {
  raised: "Raised the score",
  lowered: "Lowered the score",
  no_effect: "No real effect",
  not_used_bank_scale: "Not used by the model (bank-scale feature)",
  withheld_raised:
    "Raised the score (withheld on an assisted registration, scored as missing)",
  withheld_lowered:
    "Lowered the score (withheld on an assisted registration, scored as missing)",
  withheld_no_effect:
    "No real effect (withheld on an assisted registration, scored as missing)",
  unavailable: "Not available (the model that scored this is not loaded)",
};

// Assisted registrations never measure the form time, so this reason is
// expected for them and says nothing about the customer.
const SESSION_NOT_MEASURED = "num__missingindicator_session_length_in_minutes";

export function ReasonList({
  reasons,
  assisted = false,
}: {
  reasons: Reason[];
  assisted?: boolean;
}) {
  if (!reasons.length) {
    return <Typography color="text.secondary">No reasons recorded.</Typography>;
  }
  return (
    <ul className="reason-list">
      {reasons.map((reason) => (
        <li key={reason.code}>
          <SourceChip source={reason.source} />
          <span>
            {reason.text}
            {assisted &&
              reason.code === SESSION_NOT_MEASURED &&
              " (expected: registered on the agent's device)"}
          </span>
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
  const [eraseOpen, setEraseOpen] = useState(false);
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

  function erased() {
    // The assessment no longer exists, so drop it rather than refetch it.
    queryClient.removeQueries({
      queryKey: ["admin", "assessment", assessmentId],
    });
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
    setEraseOpen(false);
    onClose();
  }

  return (
    <>
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
            <PageError
              message="The assessment could not be loaded."
              error={assessmentQuery.error}
            />
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
                  <dd>{formatPercent(assessment.probability)}</dd>
                </div>
                <div>
                  <dt>Threshold at scoring</dt>
                  <dd>
                    {assessment.threshold_kind === "assisted"
                      ? `${formatPercent(assessment.threshold, 2)} (assisted registration)`
                      : formatPercent(assessment.threshold)}
                  </dd>
                </div>
                <div>
                  <dt>Model version</dt>
                  <dd>{assessment.model_version}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <StatusChip status={assessment.customer.status} />
                  </dd>
                </div>
              </dl>
              {assessment.audit_selected && !assessment.flagged && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Random audit: this assisted registration was not flagged. It
                  was picked at random for a check, because assisted
                  registrations withhold device details. It does not count as a
                  flag unless you confirm it as fake.
                </Alert>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                The probability is the model&apos;s estimate that this
                registration is fake. It is not proof. The model flags a
                registration at {formatPercent(assessment.threshold)} or above,
                and a rule can also flag it. In testing of model v1, about 9 in
                10 registrations flagged at its threshold were genuine, so check
                the details before deciding.
              </Typography>
              <Typography component="h3" variant="subtitle1" gutterBottom>
                Reasons
              </Typography>
              <ReasonList
                reasons={assessment.reasons}
                assisted={assessment.customer.assisted}
              />
              <Typography
                component="h3"
                variant="subtitle1"
                sx={{ mt: 2 }}
                gutterBottom
              >
                Feature values (as registered)
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Raised and lowered show the direction of each value in this
                score, not how much it mattered.
              </Typography>
              <Table size="small" aria-label="Feature values">
                <TableHead>
                  <TableRow>
                    <TableCell>Feature</TableCell>
                    <TableCell>Value</TableCell>
                    <TableCell>Effect on the score</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(assessment.features).map(([name, value]) => (
                    <TableRow key={name}>
                      <TableCell>{FEATURE_LABELS[name] ?? name}</TableCell>
                      <TableCell>{displayValue(value)}</TableCell>
                      <TableCell>
                        {EFFECT_LABELS[assessment.feature_effects[name]]}
                      </TableCell>
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
          {assessment && (
            <Button
              color="error"
              sx={{ mr: "auto" }}
              onClick={() => setEraseOpen(true)}
            >
              Erase customer data
            </Button>
          )}
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
      {assessment && (
        <EraseCustomerDialog
          customer={assessment.customer}
          open={eraseOpen}
          onClose={() => setEraseOpen(false)}
          onErased={erased}
        />
      )}
    </>
  );
}
