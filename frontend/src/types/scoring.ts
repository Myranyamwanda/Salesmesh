// Shapes of the scoring, registration, and reputation API responses.
// They mirror the backend Pydantic schemas in backend/app/schemas/.

export type Page<T> = { items: T[]; total: number };

export type ReasonSource = "model" | "rule";

export type Reason = {
  source: ReasonSource;
  code: string;
  text: string;
  contribution?: number;
};

export type Band = "High risk" | "Watch" | "Low risk" | "Insufficient data";

export type CustomerStatus = "pending_review" | "verified" | "rejected";

/** Derived from the score and the review; see backend/app/services/pipeline.py. */
export type RegistrationStatus =
  "received" | "clear" | "under_review" | "verified" | "rejected";

export type Decision = "confirmed_real" | "confirmed_fake";

export type AgentSummary = { id: string; display_name: string };

export type QueueItem = {
  assessment_id: string;
  created_at: string;
  probability: number;
  threshold: number;
  reasons: Reason[];
  customer_name: string;
  agent: AgentSummary;
};

export type Review = {
  id: string;
  decision: Decision;
  notes: string | null;
  reviewer_id: string | null;
  created_at: string;
};

export type CustomerDetail = {
  id: string;
  reference: string;
  full_name: string;
  email: string;
  mobile_phone: string;
  secondary_phone: string | null;
  date_of_birth: string;
  country: string;
  current_address_months: number;
  previous_address_months: number | null;
  assisted: boolean;
  status: CustomerStatus;
  created_at: string;
};

export type AssessmentDetail = {
  id: string;
  model_version: string;
  probability: number;
  threshold: number;
  flagged: boolean;
  reasons: Reason[];
  features: Record<string, string | number | null>;
  created_at: string;
  customer: CustomerDetail;
  registration_status: RegistrationStatus;
  agent: AgentSummary;
  review: Review | null;
};

export type ClientSummary = {
  id: string;
  email: string;
  organisation_name: string | null;
};

export type AgentRanking = {
  id: string;
  display_name: string;
  email: string;
  referral_code: string;
  status: string;
  is_active: boolean;
  client: ClientSummary | null;
  /** False when customers cannot use the referral link (no or unnamed client). */
  link_active: boolean;
  n_users: number;
  flags: number;
  confirmed_fake: number;
  pending_review: number;
  assisted_share: number;
  reputation: number;
  risk_score: number;
  band: Band;
};

export type AgentCustomer = {
  id: string;
  reference: string;
  full_name: string;
  created_at: string;
  status: CustomerStatus;
  registration_status: RegistrationStatus;
  eligibility: Eligibility;
  assisted: boolean;
  assessment_id: string | null;
  probability: number | null;
  flagged: boolean | null;
};

/** Commission eligibility input; see backend/app/services/eligibility.py. */
export type Eligibility = "eligible" | "pending" | "not_eligible";

export type EligibilityCounts = {
  eligible: number;
  pending: number;
  not_eligible: number;
};

export type MonthEligibility = EligibilityCounts & { month: string };

export type EligibilityReport = {
  totals: EligibilityCounts;
  months: MonthEligibility[];
  agents: {
    agent: AgentSummary;
    totals: EligibilityCounts;
    months: MonthEligibility[];
  }[];
};

/** Client view: pending only as a total, never per agent or per month. */
export type ClientEligibility = EligibilityCounts & {
  agents: { display_name: string; eligible: number; not_eligible: number }[];
};

/** One registration month (UTC); rates are null when there is nothing to divide. */
export type MonthKpi = {
  month: string;
  registrations: number;
  flagged: number;
  confirmed_fake: number;
  reviewed: number;
  confirmed_real: number;
  eligible: number;
  flag_rate: number | null;
  confirmed_fake_rate: number | null;
  verification_rate: number | null;
  avg_hours_to_review: number | null;
};

export type AgentMonthKpi = MonthKpi & {
  n_users_to_date: number;
  /** At the end of the month (now for the current month); null before any registration. */
  reputation: number | null;
};

export type AgentKpis = { agent: AgentSummary; months: AgentMonthKpi[] };

export type BenchmarkRow = {
  agent: AgentSummary;
  registrations: number;
  flag_rate: number | null;
  difference: number | null;
  enough_data: boolean;
};

export type NetworkKpis = {
  months: MonthKpi[];
  network_flag_rate: number | null;
  min_registrations: number;
  benchmark: BenchmarkRow[];
};

export type AgentDetail = AgentRanking & {
  customers: AgentCustomer[];
  customers_total: number;
};

export type ScoringConfig = {
  p0: number;
  k: number;
  min_users_for_band: number;
  high_risk_below: number;
  watch_below: number;
  device_email_rule_min: number;
};

export type ScoringConfigRead = ScoringConfig & {
  updated_at: string;
  updated_by: string | null;
};

export type ModelStatus = {
  status: "ok" | "failed";
  error: string | null;
  source: string;
  loaded_at: string | null;
  model_name: string | null;
  model_version: string | null;
  model_type: string | null;
  sklearn_version: string | null;
  threshold: number | null;
  metrics: Record<string, number>;
  golden_check: {
    passed: boolean;
    checked: number;
    failed: number;
    max_difference: number;
    tolerance: number;
  } | null;
};

export type Referral = {
  referral_code: string;
  display_name: string;
  link: string;
};

export type MyCustomer = {
  full_name: string;
  registered_at: string;
  assisted: boolean;
};

// Clients see only human-confirmed outcomes, never model flags or scores.
export type MonthQuality = {
  month: string;
  registrations: number;
  confirmed_fake: number;
  /** Null for a month without registrations. */
  confirmed_fake_percent: number | null;
};

export type Quality = {
  registrations: number;
  confirmed_fake: number;
  confirmed_fake_percent: number;
  under_review: number;
  trend: MonthQuality[];
};

/** Agent view: one label, recalculated at the start of each month. */
export type Standing = {
  standing: "New agent" | "Good standing" | "Account under review";
  as_of: string;
};

/** Agent view: completed months only; null below 10 registrations. */
export type MonthActivity = {
  month: string;
  registrations: number;
  eligible: number | null;
  awaiting_verification: number | null;
};

export type Activity = { as_of: string; months: MonthActivity[] };

/** Public: the agent's display name and the client's organisation name. */
export type JoinLink = { display_name: string; client_name: string };

/** The reference is shown to the customer; it reveals nothing about the score. */
export type RegistrationReceived = { message: string; reference: string };

export type JoinRegistration = {
  full_name: string;
  email: string;
  mobile_phone: string;
  secondary_phone: string | null;
  date_of_birth: string;
  country: string;
  current_address_months: number;
  previous_address_months: number | null;
  keep_signed_in: boolean;
  consent: true;
  session_length_minutes: number;
  device_id: string | null;
  user_agent: string;
  assisted: boolean;
};

export type MonitoringMonth = {
  month: string;
  assessments: number;
  flag_rate: number | null;
  mean_probability: number | null;
};

export type Monitoring = { p0: number; months: MonitoringMonth[] };
