import { TextField } from "@mui/material";
import type { UseFormRegisterReturn } from "react-hook-form";

type Props = {
  label: string;
  type?: string;
  autoComplete: string;
  registration: UseFormRegisterReturn;
  error?: string;
  hint?: string;
  autoFocus?: boolean;
};

export function FormTextField({
  label,
  type = "text",
  autoComplete,
  registration,
  error,
  hint,
  autoFocus,
}: Props) {
  return (
    <TextField
      {...registration}
      label={label}
      type={type}
      autoComplete={autoComplete}
      error={Boolean(error)}
      helperText={error ?? hint}
      autoFocus={autoFocus}
      slotProps={{ htmlInput: { maxLength: 320 } }}
    />
  );
}
