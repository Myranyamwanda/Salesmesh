import { Box, Skeleton } from "@mui/material";

/**
 * Shown while a page's code downloads: the shape of a page (header and
 * content blocks) instead of a spinner, so nothing jumps when it arrives.
 */
export function PageLoading() {
  return (
    <Box
      className="page-loading page-skeleton"
      role="status"
      aria-label="Loading page"
    >
      <Skeleton variant="rounded" height={96} />
      <div className="page-skeleton-row">
        <Skeleton variant="rounded" height={120} />
        <Skeleton variant="rounded" height={120} />
        <Skeleton variant="rounded" height={120} />
      </div>
      <Skeleton variant="rounded" height={280} />
    </Box>
  );
}
