import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineRounded";
import ErrorOutline from "@mui/icons-material/ErrorOutlineRounded";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import RemoveCircleOutline from "@mui/icons-material/RemoveCircleOutlineRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import type { Band } from "../../types/scoring";

export type Tone = "success" | "warning" | "error" | "neutral" | "info";

// Each tone has its own icon shape as well as a colour and a text label, so
// the meaning never depends on colour alone (WCAG 1.4.1).
const icons = {
  success: CheckCircleOutline,
  warning: WarningAmberRounded,
  error: ErrorOutline,
  neutral: RemoveCircleOutline,
  info: InfoOutlined,
};

/** A soft, tinted status label with an icon. Text only, never interactive. */
export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  const Icon = icons[tone];
  return (
    <span className={`status-badge tone-${tone}`}>
      <Icon aria-hidden="true" className="status-badge-icon" />
      {label}
    </span>
  );
}

const bandTones: Record<Band, Tone> = {
  "High risk": "error",
  Watch: "warning",
  "Low risk": "success",
  "Insufficient data": "neutral",
};

export function BandStatus({ band }: { band: Band }) {
  return <StatusBadge tone={bandTones[band]} label={band} />;
}
