import { createTheme } from "@mui/material/styles";
import { colors, cssVariables, fonts, radius } from "./tokens";

const heading = { fontFamily: fonts.heading, fontWeight: 700 };

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: colors.primary,
      dark: colors.primaryDark,
      light: colors.primaryTint,
    },
    secondary: { main: colors.accent },
    background: { default: colors.canvas, paper: colors.paper },
    text: { primary: colors.ink, secondary: colors.muted },
    divider: colors.line,
    error: { main: colors.error },
    success: { main: colors.success },
    warning: { main: colors.warning },
  },
  typography: {
    fontFamily: fonts.body,
    h1: heading,
    h2: heading,
    h3: heading,
    h4: heading,
    h5: heading,
    h6: { ...heading, fontSize: "1.0625rem" },
    button: { fontWeight: 600, textTransform: "none" },
  },
  shape: { borderRadius: radius.md },
  components: {
    // Publishing the tokens here keeps styles.css free of its own colours.
    MuiCssBaseline: { styleOverrides: { ":root": cssVariables } },
    MuiButton: {
      styleOverrides: {
        root: { minHeight: 44, borderRadius: radius.md, boxShadow: "none" },
      },
    },
    MuiTextField: {
      defaultProps: { fullWidth: true, size: "small" },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: radius.md, backgroundColor: colors.paper },
      },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600 } },
    },
    MuiPaper: {
      styleOverrides: { outlined: { borderColor: colors.line } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          color: colors.muted,
          backgroundColor: colors.tint,
          borderBottomColor: colors.line,
          fontSize: 12,
          fontWeight: 700,
          whiteSpace: "nowrap",
        },
        body: {
          color: colors.ink,
          borderBottomColor: colors.lineSoft,
          fontSize: 14,
          verticalAlign: "middle",
        },
        sizeSmall: { padding: "12px 16px" },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { "&:last-child td": { borderBottom: 0 } },
      },
    },
  },
});
