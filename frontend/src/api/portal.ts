// Public registration, agent, and client endpoints.
import { api } from "./client";
import type {
  Activity,
  ClientEligibility,
  JoinLink,
  JoinRegistration,
  MyCustomer,
  Page,
  Quality,
  Referral,
  RegistrationReceived,
  Standing,
} from "../types/scoring";

export async function getJoinLink(code: string) {
  const { data } = await api.get<JoinLink>(`/join/${code}`);
  return data;
}

export async function registerCustomer(
  code: string,
  registration: JoinRegistration,
) {
  const { data } = await api.post<RegistrationReceived>(
    `/join/${code}/register`,
    registration,
  );
  return data;
}

export async function getMyReferral() {
  const { data } = await api.get<Referral>("/me/referral");
  return data;
}

export async function getMyCustomers(offset: number, limit: number) {
  const { data } = await api.get<Page<MyCustomer>>("/me/customers", {
    params: { offset, limit },
  });
  return data;
}

export async function getMyStanding() {
  const { data } = await api.get<Standing>("/me/standing");
  return data;
}

export async function getMyActivity() {
  const { data } = await api.get<Activity>("/me/activity");
  return data;
}

export async function getClientEligibility() {
  const { data } = await api.get<ClientEligibility>("/client/eligibility");
  return data;
}

export async function getQuality() {
  const { data } = await api.get<Quality>("/client/quality");
  return data;
}
