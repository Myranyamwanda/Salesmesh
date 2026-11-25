/**
 * The one source of design values. theme.ts feeds them to MUI and publishes
 * them as CSS variables for styles.css; charts import them directly.
 */
export const colors = {
  // "Electric" direction (v1.4.0): indigo/violet primary with lime and cyan
  // accents. Gradients are kept for hero areas; work surfaces stay light.
  ink: "#1b1748",
  muted: "#575478",
  // At least 4.5:1 on canvas, paper, and tint (WCAG 1.4.3).
  subtle: "#5f5c80",
  line: "#e6e4f7",
  lineSoft: "#f0eefb",
  // Form field borders: 3:1 on white (WCAG 1.4.11 non-text contrast).
  fieldBorder: "#8b89a8",
  canvas: "#f7f6fe",
  paper: "#ffffff",
  tint: "#f1f0fd",
  primary: "#4f46e5",
  primaryDark: "#3730a3",
  primaryTint: "#eceafe",
  violet: "#7c3aed",
  violetText: "#6d28d9",
  violetTint: "#f3e8ff",
  navy: "#1e1b4b",
  navyDeep: "#13113a",
  onNavy: "#f5f5ff",
  onNavyMuted: "#c7c9f5",
  // Lime and cyan fills are decorative only (too light for text on white);
  // the *Text values are for text and outlines on white or their tints.
  accent: "#a3e635",
  accentText: "#3f6212",
  lime: "#a3e635",
  limeText: "#3f6212",
  limeTint: "#ecfccb",
  cyan: "#22d3ee",
  cyanText: "#0e7490",
  cyanTint: "#cffafe",
  success: "#3f6212",
  successTint: "#ecfccb",
  warning: "#b45309",
  // Status badge fills; each badge's text colour is at least 4.5:1 on it.
  warningTint: "#fef3c7",
  error: "#be123c",
  errorTint: "#ffe4e6",
};

export const chart = {
  series: "#4f46e5",
  comparison: "#0891b2",
  // Reference lines stay grey on purpose: they are not a data category.
  reference: "#6b6890",
  grid: colors.line,
  axis: colors.muted,
  markerRing: colors.paper,
};

/** Hero gradients: sign-in panel, /join header, overview hero, KPI edges. */
export const gradients = {
  hero: "linear-gradient(150deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%)",
  button: "linear-gradient(100deg, #4f46e5, #7c3aed)",
  buttonHover: "linear-gradient(100deg, #4338ca, #6d28d9)",
};

export const fonts = {
  body: '"Inter Variable", Inter, system-ui, sans-serif',
  heading: '"Manrope Variable", Manrope, system-ui, sans-serif',
};

export const radius = { sm: 8, md: 12, lg: 20 };

export const cardShadow =
  "0 1px 2px rgb(27 23 72 / 5%), 0 6px 18px rgb(27 23 72 / 5%)";

/** colors.primaryDark -> --primary-dark, for styles.css. */
export const cssVariables = {
  ...Object.fromEntries(
    Object.entries(colors).map(([name, value]) => [
      `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      value,
    ]),
  ),
  "--font-body": fonts.body,
  "--font-heading": fonts.heading,
  "--radius-sm": `${radius.sm}px`,
  "--radius-md": `${radius.md}px`,
  "--radius-lg": `${radius.lg}px`,
  "--card-shadow": cardShadow,
  "--gradient-hero": gradients.hero,
  "--gradient-button": gradients.button,
  "--gradient-button-hover": gradients.buttonHover,
};
