import { Alert, CircularProgress, Stack } from "@mui/material";

type Props = {
  error?: string;
  success?: string;
  busy?: boolean;
};

export function AuthFeedback({ error, success, busy }: Props) {
  return (
    <Stack spacing={1.5} aria-live="polite">
      {busy && <CircularProgress size={20} aria-label="Loading" />}
      {error && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}
    </Stack>
  );
}
