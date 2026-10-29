import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Pagination,
  Select,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import Add from "@mui/icons-material/Add";
import Check from "@mui/icons-material/Check";
import Close from "@mui/icons-material/Close";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import * as adminApi from "../api/admin";
import { sendPasswordReset } from "../auth/firebase";
import {
  DataTable,
  PageError,
  PageFilters,
  PageHeader,
  type DataColumn,
} from "../components/DataComponents";
import { useAuth } from "../hooks/useAuth";
import type { AuthUser, UserRole } from "../types/auth";
import { apiErrorMessage } from "../utils/errors";

const organisationName = z
  .string()
  .trim()
  .min(2, "Enter the organisation name")
  .max(200, "Use 200 characters or fewer");

const createSchema = z
  .object({
    email: z.string().trim().email("Enter a valid email address").max(320),
    role: z.enum(["admin", "client"]),
    organisationName: z.string(),
  })
  .superRefine((values, context) => {
    if (values.role !== "client") return;
    const result = organisationName.safeParse(values.organisationName);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        path: ["organisationName"],
        message: result.error.issues[0].message,
      });
    }
  });

type CreateValues = z.infer<typeof createSchema>;

function userStatus(user: AuthUser) {
  if (!user.is_active) return { label: "Inactive", color: "default" as const };
  if (user.status === "pending")
    return { label: "Pending", color: "warning" as const };
  if (user.status === "rejected")
    return { label: "Rejected", color: "error" as const };
  // Set at the first sign-in with a Firebase-verified email.
  if (!user.email_verified_at)
    return { label: "Not signed in yet", color: "info" as const };
  return { label: "Active", color: "success" as const };
}

export function AdminUserManagementPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [limit] = useState(25);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [organisationFor, setOrganisationFor] = useState<AuthUser | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin", "users", page, limit],
    queryFn: () => adminApi.listUsers(page * limit, limit),
  });
  const refreshUsers = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
  // Organisation names live in client profiles, not on the user account.
  const clientsQuery = useQuery({
    queryKey: ["admin", "clients"],
    queryFn: adminApi.listClients,
  });
  const organisations = new Map(
    (clientsQuery.data ?? []).map((client) => [
      client.id,
      client.organisation_name,
    ]),
  );
  const refreshClients = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "clients"] });

  const createMutation = useMutation({
    mutationFn: async ({ email, role, organisationName }: CreateValues) => {
      const created = await adminApi.createUser(
        role === "client"
          ? { email, role, organisation_name: organisationName.trim() }
          : { email, role },
      );
      // Firebase emails the person a link to set their password.
      const emailed = await sendPasswordReset(created.email).then(
        () => true,
        () => false,
      );
      return { created, emailed };
    },
    onSuccess: ({ created, emailed }) => {
      setCreateOpen(false);
      if (emailed) {
        setNotice(
          `Account created. A “set your password” email was sent to ${created.email}.`,
        );
      } else {
        setError(
          `Account created, but the password email could not be sent. Use “Send password email” for ${created.email}.`,
        );
      }
      void refreshUsers();
      void refreshClients();
    },
    onError: (cause) =>
      setError(apiErrorMessage(cause, "Could not create the account.")),
  });
  const organisationMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      adminApi.setClientOrganisation(id, name),
    onSuccess: () => {
      setOrganisationFor(null);
      setNotice("Organisation name saved.");
      void refreshClients();
      void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
    },
    onError: (cause) =>
      setError(apiErrorMessage(cause, "Could not save the organisation name.")),
  });
  const approveMutation = useMutation({
    mutationFn: (userId: string) => adminApi.approveAgent(userId),
    onSuccess: () => {
      setNotice("Agent account approved.");
      void refreshUsers();
    },
    onError: (cause) =>
      setError(apiErrorMessage(cause, "Could not approve this account.")),
  });
  const rejectMutation = useMutation({
    mutationFn: (userId: string) => adminApi.rejectAgent(userId),
    onSuccess: () => {
      setNotice("Agent account rejected.");
      void refreshUsers();
    },
    onError: (cause) =>
      setError(apiErrorMessage(cause, "Could not reject this account.")),
  });
  const activeMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      adminApi.setUserActive(id, active),
    onSuccess: (_, variables) => {
      setNotice(
        variables.active ? "Account activated." : "Account deactivated.",
      );
      void refreshUsers();
    },
    onError: (cause) =>
      setError(apiErrorMessage(cause, "Could not update account status.")),
  });
  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      adminApi.setUserRole(id, role),
    onSuccess: () => {
      setNotice("Account role updated.");
      void refreshUsers();
    },
    onError: (cause) =>
      setError(apiErrorMessage(cause, "Could not update account role.")),
  });
  const resendMutation = useMutation({
    // Firebase emails only existing accounts, so the backend first creates
    // the Firebase account if it is missing (accounts from before Firebase).
    mutationFn: async (user: AuthUser) => {
      await adminApi.preparePasswordEmail(user.id);
      await sendPasswordReset(user.email);
    },
    onSuccess: (_, user) => {
      setNotice(`Password email sent to ${user.email}.`);
      void refreshUsers();
    },
    onError: (cause) =>
      setError(
        apiErrorMessage(cause, "Could not send the password email. Try again."),
      ),
  });

  const rows = useMemo(
    () =>
      (usersQuery.data?.items ?? []).filter((row) => {
        const matchesSearch = row.email
          .toLowerCase()
          .includes(search.trim().toLowerCase());
        const matchesRole = roleFilter === "all" || row.role === roleFilter;
        const matchesStatus =
          statusFilter === "all" ||
          userStatus(row).label.toLowerCase().replaceAll(" ", "-") ===
            statusFilter;
        return matchesSearch && matchesRole && matchesStatus;
      }),
    [usersQuery.data?.items, search, roleFilter, statusFilter],
  );

  const columns: DataColumn<AuthUser>[] = [
    {
      key: "account",
      label: "Account",
      render: (row) => (
        <div className="account-cell">
          <strong>{row.email}</strong>
          {row.role === "client" && (
            <span>
              {organisations.get(row.id) ?? (
                <Chip
                  size="small"
                  variant="outlined"
                  color="warning"
                  label="No organisation name"
                />
              )}
            </span>
          )}
          <span>{row.id}</span>
        </div>
      ),
    },
    {
      key: "role",
      label: "Role",
      render: (row) => (
        <Typography className="role-text">{row.role}</Typography>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => {
        const status = userStatus(row);
        return (
          <Chip
            size="small"
            label={status.label}
            color={status.color}
            variant={status.color === "default" ? "outlined" : "filled"}
          />
        );
      },
    },
    {
      key: "created",
      label: "Created",
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: "permissions",
      label: "Role and access",
      render: (row) => (
        <div className="user-actions-cell">
          <FormControl size="small" className="role-select">
            <InputLabel id={`role-${row.id}`}>Role</InputLabel>
            <Select
              labelId={`role-${row.id}`}
              label="Role"
              value={row.role}
              disabled={row.id === currentUser?.id || roleMutation.isPending}
              onChange={(event) =>
                roleMutation.mutate({
                  id: row.id,
                  role: event.target.value as UserRole,
                })
              }
            >
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="agent">Agent</MenuItem>
              <MenuItem value="client">Client</MenuItem>
            </Select>
          </FormControl>
          <TooltipText
            text={
              row.id === currentUser?.id
                ? "You cannot deactivate your own account"
                : row.is_active
                  ? "Deactivate account"
                  : "Activate account"
            }
          />
          <Switch
            checked={row.is_active}
            slotProps={{
              input: {
                "aria-label": `${row.is_active ? "Deactivate" : "Activate"} ${row.email}`,
              },
            }}
            disabled={row.id === currentUser?.id || activeMutation.isPending}
            onChange={(_, checked) =>
              activeMutation.mutate({ id: row.id, active: checked })
            }
          />
          {row.role === "agent" && row.status === "pending" && (
            <Stack direction="row" spacing={0.5}>
              <Button
                size="small"
                color="success"
                aria-label={`Approve ${row.email}`}
                onClick={() => approveMutation.mutate(row.id)}
                disabled={approveMutation.isPending}
                startIcon={<Check />}
              >
                Approve
              </Button>
              <Button
                size="small"
                color="error"
                aria-label={`Reject ${row.email}`}
                onClick={() => rejectMutation.mutate(row.id)}
                disabled={rejectMutation.isPending}
                startIcon={<Close />}
              >
                Reject
              </Button>
            </Stack>
          )}
          {row.role === "client" && (
            <Button
              size="small"
              aria-label={`Set organisation name for ${row.email}`}
              onClick={() => setOrganisationFor(row)}
            >
              Organisation name
            </Button>
          )}
          {row.is_active &&
            (!row.email_verified_at || !row.firebase_linked) && (
              <Button
                size="small"
                aria-label={`Send password email to ${row.email}`}
                onClick={() => resendMutation.mutate(row)}
                disabled={resendMutation.isPending}
              >
                Send password email
              </Button>
            )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="User management"
        description="Manage authentication accounts, approve agent registrations, and control account access."
        action={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setCreateOpen(true)}
          >
            Create account
          </Button>
        }
      />
      <div className="page-toolbar">
        <PageFilters
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(0);
          }}
          searchLabel="Search this page by email"
          filterLabel="Role"
          filterValue={roleFilter}
          onFilter={(value) => {
            setRoleFilter(value);
            setPage(0);
          }}
          filterOptions={[
            { value: "all", label: "All roles" },
            { value: "admin", label: "Admin" },
            { value: "agent", label: "Agent" },
            { value: "client", label: "Client" },
          ]}
        />
        <FormControl size="small" className="status-filter">
          <InputLabel id="account-status-filter">Status</InputLabel>
          <Select
            labelId="account-status-filter"
            label="Status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(0);
            }}
          >
            <MenuItem value="all">All statuses</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="not-signed-in-yet">Not signed in yet</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
            <MenuItem value="rejected">Rejected</MenuItem>
          </Select>
        </FormControl>
      </div>
      {usersQuery.isError && (
        <PageError
          message={apiErrorMessage(usersQuery.error, "Could not load users.")}
        />
      )}
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={usersQuery.isLoading}
        emptyLabel={
          usersQuery.data?.total
            ? "No accounts match these filters."
            : "No authentication accounts yet."
        }
      />
      <div className="table-pagination">
        <Typography color="text.secondary">
          {usersQuery.data?.total ?? 0} accounts
        </Typography>
        <Pagination
          page={page + 1}
          count={Math.max(1, Math.ceil((usersQuery.data?.total ?? 0) / limit))}
          onChange={(_, nextPage) => setPage(nextPage - 1)}
          disabled={!usersQuery.data?.total}
          size="small"
          aria-label="User list pages"
        />
      </div>
      {createOpen && (
        <CreateAccountDialog
          open
          busy={createMutation.isPending}
          onClose={() => setCreateOpen(false)}
          onSubmit={(values) => createMutation.mutate(values)}
          error={
            createMutation.error
              ? apiErrorMessage(
                  createMutation.error,
                  "Could not create the account.",
                )
              : ""
          }
        />
      )}
      {organisationFor && (
        <OrganisationDialog
          email={organisationFor.email}
          initial={organisations.get(organisationFor.id) ?? ""}
          busy={organisationMutation.isPending}
          onClose={() => setOrganisationFor(null)}
          onSubmit={(name) =>
            organisationMutation.mutate({ id: organisationFor.id, name })
          }
        />
      )}
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={6000}
        onClose={() => setNotice("")}
      >
        <Alert severity="success" onClose={() => setNotice("")}>
          {notice}
        </Alert>
      </Snackbar>
    </>
  );
}

function OrganisationDialog({
  email,
  initial,
  busy,
  onClose,
  onSubmit,
}: {
  email: string;
  initial: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const result = organisationName.safeParse(name);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (result.success) onSubmit(result.data);
        }}
      >
        <DialogTitle>Organisation name</DialogTitle>
        <DialogContent className="dialog-form-content">
          <Typography color="text.secondary">
            Customers see this name on the registration links of {email}â€™s
            agents, and the consent text says their details are shared with it.
            Links stay inactive until it is set.
          </Typography>
          <TextField
            label="Organisation name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={name !== "" && !result.success}
            helperText={
              name !== "" && !result.success
                ? result.error.issues[0].message
                : undefined
            }
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={busy || !result.success}
          >
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function TooltipText({ text }: { text: string }) {
  return <Typography className="switch-hint">{text}</Typography>;
}

function CreateAccountDialog({
  open,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (values: CreateValues) => void;
}) {
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { email: "", role: "client", organisationName: "" },
  });
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = form;
  const role = useWatch({ control, name: "role" });
  function close() {
    reset();
    onClose();
  }
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit((values) => onSubmit(values))} noValidate>
        <DialogTitle>Create an authentication account</DialogTitle>
        <DialogContent className="dialog-form-content">
          <Typography color="text.secondary">
            Admin and client accounts are approved on creation. The person gets
            an email with a link to set their password; Google sign-in also
            works for the same address. Admins set up an authenticator app at
            their first sign-in.
          </Typography>
          <TextField
            label="Email address"
            type="email"
            autoComplete="email"
            {...register("email")}
            error={Boolean(errors.email)}
            helperText={errors.email?.message}
          />
          <Controller
            name="role"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth size="small">
                <InputLabel id="new-account-role">Role</InputLabel>
                <Select {...field} labelId="new-account-role" label="Role">
                  <MenuItem value="client">Client</MenuItem>
                  <MenuItem value="admin">Admin</MenuItem>
                </Select>
              </FormControl>
            )}
          />
          {role === "client" && (
            <TextField
              label="Organisation name"
              {...register("organisationName")}
              error={Boolean(errors.organisationName)}
              helperText={
                errors.organisationName?.message ??
                "Shown to customers on this client's agents' registration links"
              }
            />
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
