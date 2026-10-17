import { Button, Link as MuiLink, Stack, Typography } from "@mui/material";
import ArrowForward from "@mui/icons-material/ArrowForward";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/DataComponents";
import { useAuth } from "../hooks/useAuth";

export function ProfilePage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader
        eyebrow="ACCOUNT"
        title="My profile"
        description="Authentication profile details."
      />
      <section className="profile-summary" aria-label="Profile details">
        <div>
          <Typography className="profile-label">Email</Typography>
          <Typography>{user?.email}</Typography>
        </div>
        <div>
          <Typography className="profile-label">Role</Typography>
          <Typography sx={{ textTransform: "capitalize" }}>
            {user?.role}
          </Typography>
        </div>
        <div>
          <Typography className="profile-label">Account status</Typography>
          <Typography sx={{ textTransform: "capitalize" }}>
            {user?.status}
          </Typography>
        </div>
        <div>
          <Typography className="profile-label">Email verification</Typography>
          <Typography>
            {user?.email_verified_at ? "Verified" : "Not verified"}
          </Typography>
        </div>
        <div>
          <Typography className="profile-label">Account created</Typography>
          <Typography>
            {user?.created_at
              ? new Date(user.created_at).toLocaleDateString()
              : "—"}
          </Typography>
        </div>
      </section>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <Button
          component={Link}
          to="/change-password"
          variant="contained"
          endIcon={<ArrowForward />}
        >
          Change password
        </Button>
        <MuiLink component={Link} to="/">
          Return to workspace
        </MuiLink>
      </Stack>
    </>
  );
}
