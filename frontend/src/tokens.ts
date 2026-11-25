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

/**
 * Hero surfaces are solid colour (no gradient washes): the sign-in panel,
 * the /join header, and the Overview hero all use "night".
 */
export const gradients = {
  hero: "#15123a",
  button: "#4f46e5",
  buttonHover: "#3730a3",
};

// One family: Bricolage Grotesque (variable weight and optical size), with
// tabular figures for scores and counts.
export const fonts = {
  body: '"Bricolage Grotesque Variable", "Bricolage Grotesque", system-ui, sans-serif',
  heading:
    '"Bricolage Grotesque Variable", "Bricolage Grotesque", system-ui, sans-serif',
};

/** Type scale in px: small, label, body, lead, title, display. */
export const typeScale = {
  sm: 13,
  label: 14,
  body: 16,
  lead: 18,
  title: 32,
  display: 56,
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
  "--night": gradients.hero,
  "--flag": "#f43f5e",
  "--text-sm": `${typeScale.sm}px`,
  "--text-label": `${typeScale.label}px`,
  "--text-body": `${typeScale.body}px`,
  "--text-lead": `${typeScale.lead}px`,
  "--text-title": `${typeScale.title}px`,
  "--text-display": `${typeScale.display}px`,
  "--gradient-button": gradients.button,
  "--gradient-button-hover": gradients.buttonHover,
};
