import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { theme } from "./theme";
import "./styles.css";
import bricolageLatin from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2?url";

// Start downloading the Latin font file now, before the first text needs it,
// so the switch from the metric-matched fallback happens early (and the
// fallback's size-adjust keeps that switch from moving the layout).
const preload = document.createElement("link");
preload.rel = "preload";
preload.as = "font";
preload.type = "font/woff2";
preload.href = bricolageLatin;
preload.crossOrigin = "anonymous";
document.head.append(preload);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
