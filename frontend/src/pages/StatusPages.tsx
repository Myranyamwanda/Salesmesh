import { Button, Typography } from "@mui/material";
import { Link } from "react-router-dom";

export function ForbiddenPage() {
  return (
    <main className="status-page">
      <p className="eyebrow">403 · ACCESS RESTRICTED</p>
      <Typography variant="h4" component="h1">
        This space is for another role.
      </Typography>
      <Typography color="text.secondary">
        Your account does not have permission to view this page.
      </Typography>
      <Button component={Link} to="/" variant="contained">
        Return to your workspace
      </Button>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <main className="status-page">
      <p className="eyebrow">404 · PAGE NOT FOUND</p>
      <Typography variant="h4" component="h1">
        We couldn’t find that page.
      </Typography>
      <Typography color="text.secondary">
        The address may have changed or may be unavailable.
      </Typography>
      <Button component={Link} to="/" variant="contained">
        Return to SalesMesh
      </Button>
    </main>
  );
}

export function ErrorPage() {
  return (
    <main className="status-page" role="alert">
      <p className="eyebrow">SOMETHING WENT WRONG</p>
      <Typography variant="h4" component="h1">
        This page couldn’t load.
      </Typography>
      <Typography color="text.secondary">
        Try refreshing the page, or return to SalesMesh.
      </Typography>
      <Button component={Link} to="/" variant="contained">
        Return to SalesMesh
      </Button>
    </main>
  );
}
