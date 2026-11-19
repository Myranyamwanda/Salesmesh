import { useId, useState, type ReactNode } from "react";
import {
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  InputAdornment,
  OutlinedInput,
  Tooltip,
} from "@mui/material";
import ErrorOutline from "@mui/icons-material/ErrorOutlineRounded";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import type { UseFormRegisterReturn } from "react-hook-form";

type Props = {
  label: string;
  type?: string;
  autoComplete: string;
  registration: UseFormRegisterReturn;
  error?: string;
  hint?: string;
  placeholder?: string;
  autoFocus?: boolean;
  maxLength?: number;
  endAdornment?: ReactNode;
  /** A link on the helper line, right-aligned (e.g. "Forgot password?"). */
  aside?: ReactNode;
};

/**
 * A form field with its label above the box, which stays readable while
 * typing (a floating label shrinks into the border). Errors start with an
 * icon, so they do not rely on red alone, and are linked to the input with
 * aria-describedby.
 */
export function StackedField({
  label,
  type = "text",
  autoComplete,
  registration,
  error,
  hint,
  placeholder,
  autoFocus,
  maxLength = 320,
  endAdornment,
  aside,
}: Props) {
  const id = useId();
  const helperId = `${id}-help`;
  const helper = error ?? hint;
  return (
    <FormControl error={Boolean(error)} fullWidth className="stacked-field">
      <FormLabel htmlFor={id} className="stacked-label">
        {label}
      </FormLabel>
      <OutlinedInput
        {...registration}
        id={id}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        autoFocus={autoFocus}
        endAdornment={endAdornment}
        inputProps={{
          maxLength,
          "aria-describedby": helper ? helperId : undefined,
        }}
      />
      {(helper || aside) && (
        <div className="stacked-helper">
          {helper ? (
            <FormHelperText id={helperId}>
              {error && (
                <ErrorOutline aria-hidden="true" className="helper-icon" />
              )}
              {helper}
            </FormHelperText>
          ) : (
            <span />
          )}
          {aside}
        </div>
      )}
    </FormControl>
  );
}

export function StackedPasswordField(
  props: Omit<Props, "type" | "endAdornment" | "maxLength">,
) {
  const [visible, setVisible] = useState(false);
  return (
    <StackedField
      {...props}
      type={visible ? "text" : "password"}
      maxLength={128}
      endAdornment={
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
      }
    />
  );
}
