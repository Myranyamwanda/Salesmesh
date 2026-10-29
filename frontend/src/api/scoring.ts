// Admin endpoints for reviews, agents, scoring settings, and the model.
import { api } from "./client";
import type {
  AgentDetail,
  AgentKpis,
  AgentRanking,
  AssessmentDetail,
  Decision,
  EligibilityReport,
  ModelStatus,
  Monitoring,
  NetworkKpis,
  Page,
  QueueItem,
  Review,
  ScoringConfig,
  ScoringConfigRead,
} from "../types/scoring";

export async function getReviewQueue(offset: number, limit: number) {
  const { data } = await api.get<Page<QueueItem>>("/admin/review-queue", {
    params: { offset, limit },
  });
  return data;
}

export async function getAssessment(assessmentId: string) {
  const { data } = await api.get<AssessmentDetail>(
    `/admin/assessments/${assessmentId}`,
  );
  return data;
}

export async function reviewAssessment(
  assessmentId: string,
  decision: Decision,
  notes: string,
) {
  const { data } = await api.post<Review>(
    `/admin/assessments/${assessmentId}/review`,
    { decision, notes: notes.trim() || null },
  );
  return data;
}

export async function listAgents() {
  const { data } = await api.get<AgentRanking[]>("/admin/agents");
  return data;
}

export async function getAgent(agentId: string, offset: number, limit: number) {
  const { data } = await api.get<AgentDetail>(`/admin/agents/${agentId}`, {
    params: { offset, limit },
  });
  return data;
}

export async function updateAgent(
  agentId: string,
  changes: { display_name?: string; client_id?: string | null },
) {
  const { data } = await api.patch<AgentDetail>(
    `/admin/agents/${agentId}`,
    changes,
  );
  return data;
}

export async function getAgentKpis(agentId: string) {
  const { data } = await api.get<AgentKpis>(`/admin/agents/${agentId}/kpis`);
  return data;
}

export async function getNetworkKpis() {
  const { data } = await api.get<NetworkKpis>("/admin/kpis");
  return data;
}

export async function getEligibility() {
  const { data } = await api.get<EligibilityReport>("/admin/eligibility");
  return data;
}

export async function getScoringConfig() {
  const { data } = await api.get<ScoringConfigRead>("/admin/scoring-config");
  return data;
}

export async function updateScoringConfig(config: ScoringConfig) {
  const { data } = await api.put<ScoringConfigRead>(
    "/admin/scoring-config",
    config,
  );
  return data;
}

export async function getModel() {
  const { data } = await api.get<ModelStatus>("/admin/model");
  return data;
}

export async function reloadModel() {
  const { data } = await api.post<ModelStatus>("/admin/model/reload");
  return data;
}

export async function getMonitoring() {
  const { data } = await api.get<Monitoring>("/admin/model/monitoring");
  return data;
}

/** Erase a customer's data; the email must match the customer's email. */
export async function eraseCustomer(customerId: string, confirmEmail: string) {
  await api.post(`/admin/customers/${customerId}/erase`, {
    confirm_email: confirmEmail,
  });
}
