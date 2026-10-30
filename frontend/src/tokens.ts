/**
 * The one source of design values. theme.ts feeds them to MUI and publishes
 * them as CSS variables for styles.css; charts import them directly.
 */
export const colors = {
  ink: "#141b2d",
  muted: "#535e75",
  subtle: "#6a7488",
  line: "#e1e6ef",
  lineSoft: "#edf0f6",
  canvas: "#f4f6fa",
  paper: "#ffffff",
  tint: "#f0f3f9",
  primary: "#2a4fc7",
  primaryDark: "#1d3a9e",
  primaryTint: "#e7ecfb",
  navy: "#131c38",
  navyDeep: "#0c1328",
  onNavy: "#f3f5fb",
  onNavyMuted: "#b4bdd3",
  accent: "#e8a33d",
  success: "#17795a",
  successTint: "#e4f3ed",
  warning: "#a35c00",
  error: "#bf2f36",
};

export const chart = {
  series: "#2a78d6",
  comparison: "#c8590f",
  // Reference lines stay grey on purpose: they are not a data category.
  reference: "#5b6880",
  grid: colors.line,
  axis: colors.muted,
  markerRing: colors.paper,
};

export const fonts = {
  body: '"Inter Variable", Inter, system-ui, sans-serif',
  heading: '"Manrope Variable", Manrope, system-ui, sans-serif',
};

export const radius = { sm: 6, md: 10, lg: 14 };

export const cardShadow =
  "0 1px 2px rgb(20 27 45 / 5%), 0 4px 14px rgb(20 27 45 / 4%)";

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
};
