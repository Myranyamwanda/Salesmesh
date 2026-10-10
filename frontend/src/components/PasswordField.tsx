import { useState } from "react";
import { IconButton, InputAdornment, TextField, Tooltip } from "@mui/material";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import type { UseFormRegisterReturn } from "react-hook-form";

type Props = {
  label: string;
  autoComplete: string;
  registration: UseFormRegisterReturn;
  error?: string;
  hint?: string;
};

export function PasswordField({
  label,
  autoComplete,
  registration,
  error,
  hint,
}: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...registration}
      label={label}
      type={visible ? "text" : "password"}
      autoComplete={autoComplete}
      error={Boolean(error)}
      helperText={error ?? hint}
      slotProps={{
        htmlInput: { maxLength: 128 },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={visible ? "Hide password" : "Show password"}>
                <IconButton
                  aria-label={visible ? "Hide password" : "Show password"}
                  onClick={() => setVisible((current) => !current)}
                  edge="end"
                  size="small"
                >
                  {visible ? (
                    <VisibilityOff fontSize="small" />
                  ) : (
                    <Visibility fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
