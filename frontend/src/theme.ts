import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1d5141", dark: "#14392f", light: "#dceae4" },
    secondary: { main: "#e66c4a" },
    background: { default: "#f7f8f5", paper: "#ffffff" },
    text: { primary: "#17251f", secondary: "#66736d" },
    error: { main: "#b63737" },
    success: { main: "#287454" },
  },
  typography: {
    fontFamily: "Manrope Variable, Manrope, sans-serif",
    button: { fontWeight: 700, textTransform: "none" },
  },
  shape: { borderRadius: 6 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { minHeight: 46, borderRadius: 5, boxShadow: "none" },
      },
    },
    MuiTextField: {
      defaultProps: { fullWidth: true, size: "small" },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 5, backgroundColor: "#fff" },
      },
    },
  },
});
