import { useState } from "react";
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import AdminPanelSettingsOutlined from "@mui/icons-material/AdminPanelSettingsOutlined";
import AssessmentOutlined from "@mui/icons-material/AssessmentOutlined";
import AssignmentOutlined from "@mui/icons-material/AssignmentOutlined";
import BusinessCenterOutlined from "@mui/icons-material/BusinessCenterOutlined";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import DashboardOutlined from "@mui/icons-material/DashboardOutlined";
import FactCheckOutlined from "@mui/icons-material/FactCheckOutlined";
import GroupOutlined from "@mui/icons-material/GroupOutlined";
import HistoryOutlined from "@mui/icons-material/HistoryOutlined";
import MenuOutlined from "@mui/icons-material/MenuOutlined";
import ModelTrainingOutlined from "@mui/icons-material/ModelTrainingOutlined";
import PersonOutlined from "@mui/icons-material/PersonOutlined";
import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import ShieldOutlined from "@mui/icons-material/ShieldOutlined";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import type { UserRole } from "../types/auth";
import { roleHome } from "../utils/roleHome";

const drawerWidth = 252;

const roleLabels: Record<UserRole, string> = {
  admin: "Administrator",
  agent: "Agent",
  client: "Client",
};

const navItems: Record<
  UserRole,
  { label: string; path: string; icon: typeof DashboardOutlined }[]
> = {
  admin: [
    { label: "Overview", path: "/admin", icon: DashboardOutlined },
    { label: "Agents", path: "/admin/agents", icon: GroupOutlined },
    {
      label: "Review queue",
      path: "/admin/review-queue",
      icon: FactCheckOutlined,
    },
    {
      label: "Model management",
      path: "/admin/models",
      icon: ModelTrainingOutlined,
    },
    {
      label: "User management",
      path: "/admin/users",
      icon: AdminPanelSettingsOutlined,
    },
    { label: "Audit log", path: "/admin/audit-log", icon: HistoryOutlined },
    {
      label: "System settings",
      path: "/admin/settings",
      icon: SettingsOutlined,
    },
  ],
  agent: [
    { label: "My dashboard", path: "/agent", icon: DashboardOutlined },
    {
      label: "Onboarding tasks",
      path: "/agent/tasks",
      icon: AssignmentOutlined,
    },
  ],
  client: [
    { label: "Client dashboard", path: "/client", icon: DashboardOutlined },
    {
      label: "Onboarding reports",
      path: "/client/reports",
      icon: AssessmentOutlined,
    },
  ],
};

function SideNavigation({
  role,
  onNavigate,
}: {
  role: UserRole;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  return (
    <Box className="workspace-side-content">
      <Link
        to={roleHome[role]}
        className="workspace-brand"
        onClick={onNavigate}
      >
        <span className="brand-mark" aria-hidden="true">
          S
        </span>
        <span className="workspace-brand-copy">
          <strong>SalesMesh</strong>
          <small>ONBOARDING WORKSPACE</small>
        </span>
      </Link>
      <Divider />
      <Typography className="nav-section-label">WORKSPACE</Typography>
      <List className="workspace-nav" disablePadding>
        {navItems[role].map(({ label, path, icon: Icon }) => {
          const selected =
            location.pathname === path ||
            (path !== roleHome[role] &&
              location.pathname.startsWith(`${path}/`));
          return (
            <ListItemButton
              key={path}
              component={NavLink}
              to={path}
              selected={selected}
              onClick={onNavigate}
              className="workspace-nav-item"
            >
              <ListItemIcon>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={label} />
            </ListItemButton>
          );
        })}
      </List>
      <Box className="workspace-sidebar-bottom">
        <Divider />
        <Typography className="nav-section-label">ACCOUNT</Typography>
        <List className="workspace-nav" disablePadding>
          <ListItemButton
            component={NavLink}
            to="/profile"
            selected={location.pathname === "/profile"}
            onClick={onNavigate}
            className="workspace-nav-item"
          >
            <ListItemIcon>
              <PersonOutlined fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="My profile" />
          </ListItemButton>
          <ListItemButton
            component={NavLink}
            to="/change-password"
            selected={location.pathname === "/change-password"}
            onClick={onNavigate}
            className="workspace-nav-item"
          >
            <ListItemIcon>
              <ShieldOutlined fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Account security" />
          </ListItemButton>
        </List>
        <div className="sidebar-role">
          <span className="sidebar-role-icon">
            <BusinessCenterOutlined fontSize="small" />
          </span>
          <div>
            <strong>{roleLabels[role]}</strong>
            <span>Secure workspace</span>
          </div>
          <ChevronLeft className="sidebar-role-chevron" fontSize="small" />
        </div>
      </Box>
    </Box>
  );
}

export function WorkspaceLayout({ role }: { role: UserRole }) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const initials = user?.email.slice(0, 1).toUpperCase() ?? "U";

  async function signOut() {
    setMenuAnchor(null);
    await logout().catch(() => undefined);
    navigate("/login", { replace: true });
  }

  return (
    <Box className="workspace-app">
      <AppBar position="fixed" elevation={0} className="workspace-topbar">
        <Toolbar className="workspace-toolbar">
          <IconButton
            className="mobile-nav-toggle"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <MenuOutlined />
          </IconButton>
          <Box className="topbar-context">
            <Typography className="topbar-kicker">SALESMESH</Typography>
            <Typography className="topbar-title">
              {roleLabels[role]} workspace
            </Typography>
          </Box>
          <Box className="topbar-spacer" />
          <Chip
            className="secure-chip"
            size="small"
            icon={<ShieldOutlined />}
            label="Secure access"
          />
          <Tooltip title="Account menu">
            <IconButton
              onClick={(event) => setMenuAnchor(event.currentTarget)}
              aria-label="Open account menu"
            >
              <Avatar className="topbar-avatar">{initials}</Avatar>
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
          >
            <MenuItem disabled>{user?.email}</MenuItem>
            <Divider />
            <MenuItem
              component={Link}
              to="/profile"
              onClick={() => setMenuAnchor(null)}
            >
              My profile
            </MenuItem>
            <MenuItem
              component={Link}
              to="/change-password"
              onClick={() => setMenuAnchor(null)}
            >
              Change password
            </MenuItem>
            <MenuItem onClick={() => void signOut()}>Sign out</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        className="workspace-drawer desktop-drawer"
        sx={{ "& .MuiDrawer-paper": { width: drawerWidth } }}
      >
        <SideNavigation role={role} />
      </Drawer>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        className="workspace-drawer mobile-drawer"
        ModalProps={{ keepMounted: true }}
        sx={{ "& .MuiDrawer-paper": { width: drawerWidth, maxWidth: "86vw" } }}
      >
        <SideNavigation role={role} onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      <Box component="main" className="workspace-main">
        <Toolbar className="workspace-topbar-spacer" />
        <div className="workspace-content">
          <Outlet />
        </div>
        <footer className="workspace-footer">
          <span>SalesMesh</span>
          <span>{roleLabels[role]} workspace</span>
        </footer>
      </Box>
    </Box>
  );
}
