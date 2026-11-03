// Mock API responses for the browser checks. Typed against src/types, so a
// change to an API shape fails the type check here too. Names are invented
// demo-style data; no real customer data is used.
import type { AuditRecord, ClientAccount } from "../src/api/admin";
import type { AuthUser, UserRole } from "../src/types/auth";
import type {
  Activity,
  AgentDetail,
  AgentKpis,
  AgentRanking,
  AssessmentDetail,
  Band,
  ClientEligibility,
  EligibilityReport,
  JoinLink,
  ModelStatus,
  Monitoring,
  MonthKpi,
  MyCustomer,
  NetworkKpis,
  Page,
  Quality,
  QueueItem,
  Referral,
  ScoringConfigRead,
  Standing,
} from "../src/types/scoring";

const created = "2026-10-15T08:00:00Z";
const months = [
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
];

export function user(
  role: UserRole,
  overrides: Partial<AuthUser> = {},
): AuthUser {
  return {
    id: `${role}-1`,
    email: `${role}1@demo.example.com`,
    role,
    status: "approved",
    is_active: true,
    email_verified_at: created,
    firebase_linked: true,
    created_at: created,
    ...overrides,
  };
}

const client = {
  id: "client-1",
  email: "client1@demo.example.com",
  organisation_name: "Demo Client 1",
};

function agent(
  index: number,
  name: string,
  band: Band,
  reputation: number,
  extra: Partial<AgentRanking> = {},
): AgentRanking {
  return {
    id: `agent-${index}`,
    display_name: name,
    email: `agent${index}@demo.example.com`,
    referral_code: `AGT-7K3Q${index}AB${index}`,
    status: "approved",
    is_active: true,
    client,
    link_active: true,
    n_users: 84,
    flags: 4,
    confirmed_fake: 2,
    pending_review: 2,
    assisted_share: 0.08,
    assisted_alert: false,
    reputation,
    risk_score: Math.round((100 - reputation) * 10) / 10,
    band,
    ...extra,
  };
}

export const agents: AgentRanking[] = [
  agent(1, "Amina Otieno", "Low risk", 97.4),
  agent(2, "Brian Mwangi", "Watch", 91.2, { flags: 9 }),
  agent(3, "Chebet Kiprono", "High risk", 86.8, {
    flags: 14,
    confirmed_fake: 9,
  }),
  agent(4, "Dr Akinyi Korir", "Low risk", 94.9, {
    assisted_share: 0.6,
    assisted_alert: true,
  }),
  agent(5, "Esther Wanjiku", "Insufficient data", 98.1, {
    n_users: 12,
    flags: 0,
    confirmed_fake: 0,
    pending_review: 0,
  }),
  agent(6, "Felix Ochieng", "Low risk", 96.0, {
    client: null,
    link_active: false,
  }),
];

const modelReason = {
  source: "model" as const,
  code: "num__name_email_similarity",
  text: "Name and email address are not alike",
  contribution: 0.42,
};
const ruleReason = {
  source: "rule" as const,
  code: "rule__device_distinct_emails_8w",
  text: "One device used for 3 or more email addresses in 8 weeks",
};
const auditReason = {
  source: "audit" as const,
  code: "audit__assisted",
  text: "Random audit (assisted registration)",
};

export const reviewQueue: Page<QueueItem> = {
  total: 3,
  items: [
    {
      assessment_id: "assessment-1",
      created_at: created,
      probability: 0.081,
      threshold: 0.035,
      audit: false,
      reasons: [ruleReason, modelReason],
      customer_name: "Wanjiru Kamau",
      agent: { id: "agent-3", display_name: "Chebet Kiprono" },
    },
    {
      assessment_id: "assessment-2",
      created_at: created,
      probability: 0.012,
      threshold: 0.008039,
      audit: false,
      reasons: [modelReason],
      customer_name: "Otieno Barasa",
      agent: { id: "agent-4", display_name: "Dr Akinyi Korir" },
    },
    {
      assessment_id: "assessment-3",
      created_at: created,
      probability: 0.004,
      threshold: 0.008039,
      audit: true,
      reasons: [auditReason],
      customer_name: "Njeri Muthoni",
      agent: { id: "agent-1", display_name: "Amina Otieno" },
    },
  ],
};

export const assessment: AssessmentDetail = {
  id: "assessment-1",
  model_version: "1.0.0",
  probability: 0.081,
  threshold: 0.035,
  threshold_kind: "standard",
  flagged: true,
  audit_selected: false,
  reasons: [ruleReason, modelReason],
  features: {
    name_email_similarity: 0.12,
    prev_address_months_count: null,
    current_address_months_count: 14,
    date_of_birth_distinct_emails_4w: 0,
    email_is_free: 1,
    phone_home_valid: 0,
    phone_mobile_valid: 1,
    foreign_request: 0,
    source: "INTERNET",
    session_length_in_minutes: 3.4,
    device_os: "other",
    keep_alive_session: 0,
    device_distinct_emails_8w: 3,
  },
  feature_effects: {
    name_email_similarity: "raised",
    prev_address_months_count: "raised",
    current_address_months_count: "lowered",
    date_of_birth_distinct_emails_4w: "not_used_bank_scale",
    email_is_free: "raised",
    phone_home_valid: "raised",
    phone_mobile_valid: "lowered",
    foreign_request: "no_effect",
    source: "no_effect",
    session_length_in_minutes: "lowered",
    device_os: "raised",
    keep_alive_session: "raised",
    device_distinct_emails_8w: "raised",
  },
  created_at: created,
  customer: {
    id: "customer-1",
    reference: "REG-4F7K2M",
    full_name: "Wanjiru Kamau",
    email: "wanjiru.k@example.com",
    mobile_phone: "+254712345678",
    secondary_phone: null,
    date_of_birth: "1994-03-12",
    country: "KE",
    current_address_months: 14,
    previous_address_months: null,
    assisted: false,
    status: "pending_review",
    created_at: created,
  },
  registration_status: "under_review",
  agent: { id: "agent-3", display_name: "Chebet Kiprono" },
  review: null,
};

export const agentDetail: AgentDetail = {
  ...agents[2],
  customers_total: 3,
  customers: [
    {
      id: "customer-1",
      reference: "REG-4F7K2M",
      full_name: "Wanjiru Kamau",
      created_at: created,
      status: "pending_review",
      registration_status: "under_review",
      eligibility: "pending",
      assisted: false,
      assessment_id: "assessment-1",
      probability: 0.081,
      flagged: true,
    },
    {
      id: "customer-2",
      reference: "REG-9H2D3P",
      full_name: "Kamau Njoroge",
      created_at: created,
      status: "verified",
      registration_status: "clear",
      eligibility: "eligible",
      assisted: true,
      assessment_id: "assessment-4",
      probability: 0.006,
      flagged: false,
    },
    {
      id: "customer-3",
      reference: "REG-2B8X6Q",
      full_name: "Achieng Odhiambo",
      created_at: created,
      status: "rejected",
      registration_status: "rejected",
      eligibility: "not_eligible",
      assisted: false,
      assessment_id: "assessment-5",
      probability: 0.2,
      flagged: true,
    },
  ],
};

function monthKpi(month: string, index: number): MonthKpi {
  const registrations = 520 + index * 40;
  const flagged = 30 + index * 2;
  return {
    month,
    registrations,
    flagged,
    confirmed_fake: 9 + index,
    reviewed: 25,
    confirmed_real: 16 - index,
    eligible: registrations - flagged,
    flag_rate: flagged / registrations,
    confirmed_fake_rate: (9 + index) / registrations,
    verification_rate: 0.9,
    avg_hours_to_review: 20 + index,
  };
}

export const agentKpis: AgentKpis = {
  agent: { id: "agent-3", display_name: "Chebet Kiprono" },
  months: months.map((month, index) => ({
    ...monthKpi(month, index),
    n_users_to_date: 14 * (index + 1),
    reputation: 92 - index,
  })),
};

export const networkKpis: NetworkKpis = {
  months: months.map(monthKpi),
  network_flag_rate: 0.063,
  min_registrations: 30,
  benchmark: agents.map((row, index) => ({
    agent: { id: row.id, display_name: row.display_name },
    registrations: row.n_users,
    flag_rate: row.n_users >= 30 ? 0.03 + index * 0.02 : null,
    difference: row.n_users >= 30 ? index * 0.02 - 0.033 : null,
    enough_data: row.n_users >= 30,
    assisted_alert: row.assisted_alert,
  })),
};

const counts = { eligible: 3104, pending: 33, not_eligible: 251 };
export const eligibility: EligibilityReport = {
  totals: counts,
  months: months.map((month) => ({ month, ...counts })),
  agents: agents.slice(0, 3).map((row) => ({
    agent: { id: row.id, display_name: row.display_name },
    totals: { eligible: 70, pending: 2, not_eligible: 12 },
    months: months.map((month) => ({
      month,
      eligible: 12,
      pending: 0,
      not_eligible: 2,
    })),
  })),
};

export const scoringConfig: ScoringConfigRead = {
  p0: 0.0539,
  k: 10,
  min_users_for_band: 30,
  high_risk_below: 90,
  watch_below: 92,
  device_email_rule_min: 3,
  assisted_threshold: 0.008039,
  audit_share: 0.1,
  assisted_alert_multiple: 2,
  updated_at: created,
  updated_by: "admin1@demo.example.com",
};

export const modelStatus: ModelStatus = {
  status: "ok",
  error: null,
  source: "local",
  loaded_at: created,
  model_name: "baf-logistic-regression",
  model_version: "1.0.0",
  model_type: "CalibratedClassifierCV",
  sklearn_version: "1.7.2",
  threshold: 0.035,
  metrics: { "ROC-AUC": 0.8165, recall: 0.344 },
  golden_check: {
    passed: true,
    checked: 20,
    failed: 0,
    max_difference: 4.96e-7,
    tolerance: 1e-5,
  },
};

export const monitoring: Monitoring = {
  p0: 0.0539,
  months: months.map((month, index) => ({
    month,
    assessments: 520 + index * 40,
    flag_rate: 0.055 + index * 0.002,
    mean_probability: 0.012,
  })),
};

export const users: Page<AuthUser> = {
  total: 4,
  items: [
    user("admin"),
    user("client"),
    user("agent"),
    user("agent", {
      id: "agent-pending",
      email: "new.agent@example.com",
      status: "pending",
      firebase_linked: true,
    }),
  ],
};

export const clients: ClientAccount[] = [
  {
    id: "client-1",
    email: client.email,
    is_active: true,
    organisation_name: "Demo Client 1",
  },
  {
    id: "client-2",
    email: "client2@demo.example.com",
    is_active: true,
    organisation_name: null,
  },
];

export const auditLogs: Page<AuditRecord> = {
  total: 3,
  items: [
    {
      id: "audit-1",
      actor_user_id: "admin-1",
      target_user_id: "agent-pending",
      subject: null,
      action: "admin.user.approve",
      outcome: "success",
      request_id: "req-1",
      created_at: created,
    },
    {
      id: "audit-2",
      actor_user_id: "admin-1",
      target_user_id: null,
      subject: "assessment:assessment-1",
      action: "review.decision",
      outcome: "success",
      request_id: "req-2",
      created_at: created,
    },
    {
      id: "audit-3",
      actor_user_id: null,
      target_user_id: null,
      subject: null,
      action: "auth.login",
      outcome: "failure",
      request_id: "req-3",
      created_at: created,
    },
  ],
};

export const referral: Referral = {
  referral_code: "AGT-7K3Q2MNP",
  display_name: "Amina Otieno",
  link: "http://localhost:4173/join/AGT-7K3Q2MNP",
};

export const myCustomers: Page<MyCustomer> = {
  total: 2,
  items: [
    { full_name: "Wanjiru Kamau", registered_at: created, assisted: false },
    { full_name: "Kamau Njoroge", registered_at: created, assisted: true },
  ],
};

export const standing: Standing = {
  standing: "Good standing",
  as_of: "2026-11-01",
};

export const activity: Activity = {
  as_of: "2026-11-01",
  months: months.map((month, index) => ({
    month,
    registrations: index === 0 ? 6 : 14 + index,
    eligible: index === 0 ? null : 12 + index,
    awaiting_verification: index === 0 ? null : 1,
  })),
};

export const quality: Quality = {
  registrations: 1130,
  confirmed_fake: 21,
  confirmed_fake_percent: 1.9,
  under_review: 11,
  trend: months.map((month, index) => ({
    month,
    registrations: 170 + index * 10,
    confirmed_fake: 3 + (index % 2),
    confirmed_fake_percent: 1.8,
  })),
};

export const clientEligibility: ClientEligibility = {
  eligible: 1050,
  pending: 11,
  not_eligible: 69,
  agents: agents.slice(0, 3).map((row) => ({
    display_name: row.display_name,
    eligible: 80,
    not_eligible: 4,
  })),
};

export const joinLink: JoinLink = {
  display_name: "Amina Otieno",
  client_name: "Demo Client 1",
};
