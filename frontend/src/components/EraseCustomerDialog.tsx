import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import * as scoringApi from "../api/scoring";
import type { CustomerDetail } from "../types/scoring";
import { apiErrorMessage } from "../utils/errors";

const REJECTED_WARNING =
  "This customer was confirmed fake. Erasing it removes fraud evidence from the agent's record, and the agent's reputation will rise. Data needed for fraud prevention or legal claims may be kept despite an erasure request. Confirm that erasure is appropriate.";
const PENDING_WARNING =
  "This customer is flagged and awaiting review. Consider completing the review before you erase the data.";

/**
 * Erase a customer's personal data (Kenya Data Protection Act 2019).
 * The admin must type the customer's email; the server checks it again.
 * Warnings for confirmed-fake or pending customers inform but do not block.
 */
export function EraseCustomerDialog({
  customer,
  open,
  onClose,
  onErased,
}: {
  customer: Pick<CustomerDetail, "id" | "email" | "status">;
  open: boolean;
  onClose: () => void;
  onErased: () => void;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === customer.email.toLowerCase();
  const eraseMutation = useMutation({
    mutationFn: () => scoringApi.eraseCustomer(customer.id, typed.trim()),
    onSuccess: () => {
      setTyped("");
      onErased();
    },
  });
  const warning =
    customer.status === "rejected"
      ? REJECTED_WARNING
      : customer.status === "pending_review"
        ? PENDING_WARNING
        : null;

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="erase-title">
      <DialogTitle id="erase-title">Erase customer data</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          This permanently deletes the customer's personal data, risk
          assessment, and review. It cannot be undone. The erasure is recorded
          in the audit log without any personal data.
        </DialogContentText>
        {warning && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {warning}
          </Alert>
        )}
        <TextField
          label="Type the customer's email to confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          helperText={customer.email}
          autoComplete="off"
        />
        {eraseMutation.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {apiErrorMessage(eraseMutation.error, "The data was not erased.")}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          disabled={!matches || eraseMutation.isPending}
          onClick={() => eraseMutation.mutate()}
        >
          Erase
        </Button>
      </DialogActions>
    </Dialog>
  );
}
