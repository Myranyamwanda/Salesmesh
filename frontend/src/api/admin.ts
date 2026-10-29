import { api } from "./client";
import type { AuthUser, UserRole } from "../types/auth";

export type Page<T> = { items: T[]; total: number };

export type AuditRecord = {
  id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  subject: string | null;
  action: string;
  outcome: string;
  request_id: string | null;
  created_at: string;
};

export async function listUsers(offset: number, limit: number) {
  const { data } = await api.get<Page<AuthUser>>("/admin/users", {
    params: { offset, limit },
  });
  return data;
}

export async function getUser(userId: string) {
  const { data } = await api.get<AuthUser>(`/admin/users/${userId}`);
  return data;
}

/** Creates the SalesMesh and Firebase account; there is no password yet. */
export async function createUser(input: {
  email: string;
  role: "admin" | "client";
  /** Required for clients, absent for admins. */
  organisation_name?: string;
}) {
  const { data } = await api.post<AuthUser>("/admin/users", input);
  return data;
}

export type ClientAccount = {
  id: string;
  email: string;
  is_active: boolean;
  /** Null for clients created before v1.2.0; their agents' links stay inactive. */
  organisation_name: string | null;
};

export async function listClients() {
  const { data } = await api.get<ClientAccount[]>("/admin/clients");
  return data;
}

export async function setClientOrganisation(
  userId: string,
  organisationName: string,
) {
  const { data } = await api.put<ClientAccount>(
    `/admin/clients/${userId}/organisation`,
    { organisation_name: organisationName },
  );
  return data;
}

/** "Acme Bank (client@example.com)", or the email alone without a name. */
export function clientLabel(client: {
  email: string;
  organisation_name: string | null;
}) {
  return client.organisation_name
    ? `${client.organisation_name} (${client.email})`
    : client.email;
}

/** Make sure the user has a Firebase account before Firebase emails them. */
export async function preparePasswordEmail(userId: string) {
  const { data } = await api.post<AuthUser>(
    `/admin/users/${userId}/password-email`,
  );
  return data;
}

export async function approveAgent(userId: string) {
  const { data } = await api.post<AuthUser>(`/admin/users/${userId}/approve`);
  return data;
}

export async function rejectAgent(userId: string) {
  const { data } = await api.post<AuthUser>(`/admin/users/${userId}/reject`);
  return data;
}

export async function setUserActive(userId: string, is_active: boolean) {
  const { data } = await api.patch<AuthUser>(`/admin/users/${userId}/active`, {
    is_active,
  });
  return data;
}

export async function setUserRole(userId: string, role: UserRole) {
  const { data } = await api.patch<AuthUser>(`/admin/users/${userId}/role`, {
    role,
  });
  return data;
}

export async function listAuditLogs(offset: number, limit: number) {
  const { data } = await api.get<Page<AuditRecord>>("/admin/audit-logs", {
    params: { offset, limit },
  });
  return data;
}
