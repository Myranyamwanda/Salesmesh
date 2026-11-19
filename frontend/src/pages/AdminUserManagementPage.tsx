import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
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
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import * as adminApi from "../api/admin";
import { sendPasswordReset } from "../auth/firebase";
import { PageError, PageHeader } from "../components/DataComponents";
import { DetailDrawer, DetailSection } from "../components/table/DetailDrawer";
import { ListTable, type ListColumn } from "../components/table/ListTable";
import { StatusBadge, type Tone } from "../components/table/StatusBadge";
import { TableToolbar } from "../components/table/TableToolbar";
import {
  pageOffset,
  useClampPage,
  useListParams,
} from "../components/table/useListParams";
import { useAuth } from "../hooks/useAuth";
import type { AuthUser, UserRole } from "../types/auth";
import { apiErrorMessage } from "../utils/errors";
import { formatCount, formatDate, formatDateTime } from "../utils/format";

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

function userStatus(user: AuthUser): { label: string; tone: Tone } {
  if (!user.is_active) return { label: "Inactive", tone: "neutral" };
  if (user.status === "pending") return { label: "Pending", tone: "warning" };
  if (user.status === "rejected") return { label: "Rejected", tone: "error" };
  // Set at the first sign-in with a Firebase-verified email.
  if (!user.email_verified_at)
    return { label: "Not signed in yet", tone: "info" };
  return { label: "Active", tone: "success" };
}

function UserStatus({ user }: { user: AuthUser }) {
  const { label, tone } = userStatus(user);
  return <StatusBadge tone={tone} label={label} />;
}

const roleOptions = [
  { value: "all", label: "All roles" },
  { value: "admin", label: "Admin" },
  { value: "agent", label: "Agent" },
  { value: "client", label: "Client" },
];

// Values are the API's status filter (AccountStatus).
const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "not_signed_in", label: "Not signed in yet" },
  { value: "inactive", label: "Inactive" },
  { value: "rejected", label: "Rejected" },
];

const listDefaults = {
  sort: "created_at",
  dir: "asc",
  filters: { role: "all", status: "all" },
} as const;

export function AdminUserManagementPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { params, update, filtered, clearFilters } =
    useListParams(listDefaults);
  const [openUser, setOpenUser] = useState<AuthUser | null>(null);
  const { role: roleFilter, status: statusFilter } = params.filters;
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [organisationFor, setOrganisationFor] = useState<AuthUser | null>(null);
  const [deactivating, setDeactivating] = useState<AuthUser | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin", "users", params],
    queryFn: () =>
      adminApi.listUsers({
        offset: pageOffset(params),
        limit: params.size,
        q: params.q.trim(),
        role: roleFilter === "all" ? undefined : (roleFilter as UserRole),
        status:
          statusFilter === "all"
            ? undefined
            : (statusFilter as adminApi.AccountStatus),
      }),
    placeholderData: keepPreviousData,
  });
  const total = usersQuery.data?.total;
  useClampPage(total, params, update);
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

  // The drawer shows the row as last loaded, so it follows each change.
  const current =
    usersQuery.data?.items.find((row) => row.id === openUser?.id) ?? openUser;
  const isSelf = current?.id === currentUser?.id;

  const columns: ListColumn<AuthUser>[] = [
    {
      key: "account",
      label: "Account",
      card: "title",
      render: (row) => (
        <span className="cell-stack">
          <strong>{row.email}</strong>
          {row.role === "client" && (
            <span>{organisations.get(row.id) ?? "No organisation name"}</span>
          )}
        </span>
      ),
    },
    {
      key: "role",
      label: "Role",
      card: "stat",
      render: (row) => <span className="sentence-case">{row.role}</span>,
    },
    {
      key: "status",
      label: "Status",
      card: "badge",
      render: (row) => <UserStatus user={row} />,
    },
    {
      key: "created",
      label: "Created",
      card: "stat",
      render: (row) => formatDate(row.created_at),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="User management"
        description="Manage authentication accounts, approve agent registrations, and control account access. Open an account to change it."
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
      {usersQuery.isError && (
        <PageError
          message={apiErrorMessage(usersQuery.error, "Could not load users.")}
        />
      )}
      {error && (
        <Alert
          severity="error"
          onClose={() => setError("")}
          className="page-notice"
        >
          {error}
        </Alert>
      )}
      <ListTable
        label="Users"
        columns={columns}
        rows={usersQuery.data?.items ?? []}
        rowKey={(row) => row.id}
        onOpen={setOpenUser}
        openKey={openUser?.id}
        loading={usersQuery.isPending}
        total={total ?? 0}
        page={params.page}
        size={params.size}
        onPage={(page) => update({ page })}
        onSize={(size) => update({ size })}
        filtered={filtered}
        onClearFilters={clearFilters}
        emptyTitle="No accounts yet"
        emptyDescription="Create an admin or client account, or wait for agents to register."
        toolbar={
          <TableToolbar
            search={params.q}
            searchLabel="Search by email"
            onSearch={(q) => update({ q })}
            filters={[
              {
                name: "role",
                label: "Role",
                value: roleFilter,
                options: roleOptions,
              },
              {
                name: "status",
                label: "Status",
                value: statusFilter,
                options: statusOptions,
              },
            ]}
            onFilter={(name, value) => update({ filters: { [name]: value } })}
            count={
              total === undefined
                ? undefined
                : `${formatCount(total)} ${total === 1 ? "account" : "accounts"}${filtered ? " match" : ""}`
            }
          />
        }
      />
      <DetailDrawer
        open={current !== null}
        onClose={() => setOpenUser(null)}
        title={current?.email ?? ""}
        subtitle={
          current ? `Created ${formatDateTime(current.created_at)}` : undefined
        }
        badge={current && <UserStatus user={current} />}
      >
        {current && (
          <>
            <DetailSection
              title="Account"
              items={[
                {
                  label: "Role",
                  value: <span className="sentence-case">{current.role}</span>,
                },
                ...(current.role === "client"
                  ? [
                      {
                        label: "Organisation",
                        value: organisations.get(current.id) ?? (
                          <StatusBadge
                            tone="warning"
                            label="No organisation name"
                          />
                        ),
                      },
                    ]
                  : []),
                {
                  label: "Email verified",
                  value: current.email_verified_at
                    ? formatDate(current.email_verified_at)
                    : "Not yet",
                },
                {
                  label: "Signs in with Firebase",
                  value: current.firebase_linked ? "Yes" : "Not yet",
                },
                {
                  label: "User ID",
                  value: <code className="code-text">{current.id}</code>,
                },
              ]}
            />
            <section className="detail-section">
              <Typography component="h3" className="detail-section-title">
                Role and access
              </Typography>
              <Stack spacing={2} className="drawer-controls">
                <FormControl size="small" fullWidth>
                  <InputLabel id={`role-${current.id}`}>Role</InputLabel>
                  <Select
                    labelId={`role-${current.id}`}
                    label="Role"
                    value={current.role}
                    disabled={isSelf || roleMutation.isPending}
                    onChange={(event) =>
                      roleMutation.mutate({
                        id: current.id,
                        role: event.target.value as UserRole,
                      })
                    }
                  >
                    <MenuItem value="admin">Admin</MenuItem>
                    <MenuItem value="agent">Agent</MenuItem>
                    <MenuItem value="client">Client</MenuItem>
                  </Select>
                </FormControl>
                <div className="switch-row">
                  <Switch
                    checked={current.is_active}
                    slotProps={{
                      input: {
                        "aria-label": `${current.is_active ? "Deactivate" : "Activate"} ${current.email}`,
                      },
                    }}
                    disabled={isSelf || activeMutation.isPending}
                    onChange={(_, checked) => {
                      if (checked)
                        activeMutation.mutate({ id: current.id, active: true });
                      else setDeactivating(current);
                    }}
                  />
                  <TooltipText
                    text={
                      isSelf
                        ? "You cannot deactivate your own account"
                        : current.is_active
                          ? "Active: switch off to deactivate"
                          : "Inactive: switch on to activate"
                    }
                  />
                </div>
                {current.role === "agent" && current.status === "pending" && (
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      color="success"
                      aria-label={`Approve ${current.email}`}
                      onClick={() => approveMutation.mutate(current.id)}
                      disabled={approveMutation.isPending}
                      startIcon={<Check />}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      aria-label={`Reject ${current.email}`}
                      onClick={() => rejectMutation.mutate(current.id)}
                      disabled={rejectMutation.isPending}
                      startIcon={<Close />}
                    >
                      Reject
                    </Button>
                  </Stack>
                )}
                {current.role === "client" && (
                  <Button
                    variant="outlined"
                    aria-label={`Set organisation name for ${current.email}`}
                    onClick={() => setOrganisationFor(current)}
                  >
                    Organisation name
                  </Button>
                )}
                {current.is_active &&
                  (!current.email_verified_at || !current.firebase_linked) && (
                    <Button
                      variant="outlined"
                      aria-label={`Send password email to ${current.email}`}
                      onClick={() => resendMutation.mutate(current)}
                      disabled={resendMutation.isPending}
                    >
                      Send password email
                    </Button>
                  )}
              </Stack>
            </section>
          </>
        )}
      </DetailDrawer>
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
      <Dialog
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        aria-labelledby="deactivate-title"
      >
        <DialogTitle id="deactivate-title">
          Deactivate this account?
        </DialogTitle>
        <DialogContent>
          <Typography>
            {deactivating?.email} will be signed out and cannot sign in. If this
            is an agent, their referral link stops working. You can activate the
            account again later.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeactivating(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (deactivating) {
                activeMutation.mutate({ id: deactivating.id, active: false });
              }
              setDeactivating(null);
            }}
          >
            Deactivate account
          </Button>
        </DialogActions>
      </Dialog>
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
            Customers see this name on the registration links of {email}’s
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
