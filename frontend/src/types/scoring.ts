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
  agent: AgentSummary;
  review: Review | null;
};

export type AgentRanking = {
  id: string;
  display_name: string;
  email: string;
  referral_code: string;
  status: string;
  is_active: boolean;
  client: { id: string; email: string } | null;
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
  full_name: string;
  created_at: string;
  status: CustomerStatus;
  assisted: boolean;
  assessment_id: string | null;
  probability: number | null;
  flagged: boolean | null;
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

export type MonthQuality = {
  month: string;
  registrations: number;
  flagged: number;
  confirmed_fake: number;
};

export type Quality = {
  registrations: number;
  flagged: number;
  flagged_percent: number;
  confirmed_fake: number;
  confirmed_fake_percent: number;
  pending_review: number;
  trend: MonthQuality[];
};

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
