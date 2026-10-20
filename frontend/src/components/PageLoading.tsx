import { Box, CircularProgress } from "@mui/material";

/** Shown while a lazily loaded page's code is downloading. */
export function PageLoading() {
  return (
    <Box className="page-loading">
      <CircularProgress aria-label="Loading page" />
    </Box>
  );
}
