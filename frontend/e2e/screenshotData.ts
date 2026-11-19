// Invented data for the screenshot specs (screenshots.spec.ts and
// identity-screenshots.spec.ts), sized like the demo network. Not a test.

// --- Invented data, sized like the demo network ------------------------------

const first = ["Amina", "Brian", "Chebet", "Daudi", "Esther", "Felix", "Grace"];
const last = ["Otieno", "Mwangi", "Kiprono", "Korir", "Wanjiku", "Ochieng"];
const created = "2026-10-15T08:00:00Z";
export const months = Array.from({ length: 12 }, (_, i) => {
  const date = new Date(Date.UTC(2025, 11 + i, 1));
  return date.toISOString().slice(0, 7);
});
const client = {
  id: "client-1",
  email: "client1@demo.example.com",
  organisation_name: "Demo Client 1",
};

function name(i: number) {
  return `${first[i % first.length]} ${last[(i * 5) % last.length]}`;
}

function band(reputation: number, customers: number) {
  if (customers < 30) return "Insufficient data";
  if (reputation < 90) return "High risk";
  if (reputation < 92) return "Watch";
  return "Low risk";
}

export const agents = Array.from({ length: 41 }, (_, i) => {
  const customers = i === 7 ? 18 : 60 + ((i * 37) % 70);
  const reputation = Math.round((86 + ((i * 53) % 135) / 10) * 10) / 10;
  const flags = Math.max(0, Math.round(((100 - reputation) / 100) * customers));
  const pending = i % 3 === 0 ? Math.ceil(flags / 3) : 0;
  return {
    id: `agent-${i + 1}`,
    display_name: name(i),
    email: `agent${i + 1}@demo.example.com`,
    referral_code: `AGT-${(i * 7919).toString(36).toUpperCase().padStart(8, "K")}`,
    status: "approved",
    is_active: true,
    client: i === 12 ? null : client,
    link_active: i !== 12,
    n_users: customers,
    flags,
    confirmed_fake: flags - pending,
    pending_review: pending,
    assisted_share: i === 40 ? 0.6 : 0.05 + (i % 5) / 50,
    assisted_alert: i === 40,
    reputation,
    risk_score: Math.round((100 - reputation) * 10) / 10,
    band: band(reputation, customers),
  };
}).sort((a, b) => a.reputation - b.reputation);

const customerNames = ["Wanjiru Kamau", "Kamau Njoroge", "Achieng Odhiambo"];
const statuses = [
  ["verified", "clear", "eligible", false],
  ["pending_review", "under_review", "pending", true],
  ["verified", "verified", "eligible", true],
  ["rejected", "rejected", "not_eligible", true],
] as const;

export const customers = Array.from({ length: 100 }, (_, i) => {
  const [status, registration, eligibility, flagged] =
    statuses[i % 7 === 0 ? 1 + (i % 3) : 0];
  return {
    id: `customer-${i}`,
    reference: `REG-${(i * 104729).toString(36).toUpperCase().padStart(6, "Q")}`,
    full_name: `${customerNames[i % 3].split(" ")[0]} ${last[i % last.length]}`,
    created_at: new Date(Date.UTC(2026, 9, 30 - (i % 30), 9)).toISOString(),
    status,
    registration_status: registration,
    eligibility,
    assisted: i % 9 === 0,
    assessment_id: `assessment-${i}`,
    probability: flagged ? 0.04 + (i % 5) / 100 : 0.004 + (i % 7) / 1000,
    flagged,
  };
});

const modelReason = {
  source: "model",
  code: "num__prev_address_months_count",
  text: "No previous address provided",
  contribution: 0.42,
};
const ruleReason = {
  source: "rule",
  code: "rule__device_distinct_emails_8w",
  text: "One device used for 3 or more email addresses in 8 weeks",
};
const auditReason = {
  source: "audit",
  code: "audit__assisted",
  text: "Random audit (assisted registration)",
};

export const queue = Array.from({ length: 63 }, (_, i) => ({
  assessment_id: `assessment-${i}`,
  created_at: new Date(
    Date.UTC(2026, 9, 1 + (i % 30), 8 + (i % 9)),
  ).toISOString(),
  probability: i % 6 === 5 ? 0.006 : 0.036 + (i % 9) / 100,
  threshold: i % 6 === 5 ? 0.014058 : 0.03539,
  audit: i % 6 === 5,
  reasons:
    i % 6 === 5
      ? [auditReason]
      : i % 4 === 0
        ? [ruleReason, modelReason]
        : [modelReason],
  customer_name: customers[i].full_name,
  agent: { id: agents[i % 41].id, display_name: agents[i % 41].display_name },
}));

export const users = [
  ...["admin", "client", "client", "client"].map((role, i) => ({
    id: `${role}-${i}`,
    email: `${role}${i}@demo.example.com`,
    role,
    status: "approved",
    is_active: true,
    email_verified_at: created,
    firebase_linked: true,
    created_at: created,
  })),
  ...agents.map((agent, i) => ({
    id: agent.id,
    email: agent.email,
    role: "agent",
    status: i % 13 === 4 ? "pending" : "approved",
    is_active: i % 17 !== 9,
    email_verified_at: i % 11 === 3 ? null : created,
    firebase_linked: true,
    created_at: created,
  })),
];

const actions = [
  ["login", "success"],
  ["login", "failure"],
  ["agent_approved", "success"],
  ["review_decision", "success"],
  ["scoring_config_updated", "success"],
  ["users_listed", "success"],
] as const;

export const auditLogs = Array.from({ length: 128 }, (_, i) => ({
  id: `audit-${i}`,
  actor_user_id:
    i % 5 === 1
      ? null
      : `9c1e4a7b-${String(1000 + i).padStart(4, "0")}-4c1a-9f0e-2b7d5c3a8e61`,
  target_user_id:
    i % 3 === 0
      ? `5f2d8c1a-${String(2000 + i).padStart(4, "0")}-4b6e-8a3d-1c9e7f4b2a05`
      : null,
  subject: i % 6 === 3 ? `assessment:${customers[i % 100].id}` : null,
  action: actions[i % actions.length][0],
  outcome: actions[i % actions.length][1],
  request_id: `r-${(i * 7907).toString(16).padStart(8, "0")}`,
  created_at: new Date(
    Date.UTC(2026, 10, 18, 17, 59 - (i % 60), 0),
  ).toISOString(),
}));

export function eligibilityFor(i: number) {
  return {
    eligible: 50 + ((i * 13) % 60),
    pending: i % 4,
    not_eligible: i % 7,
  };
}

export const eligibilityAgents = [...agents]
  .sort((a, b) => a.display_name.localeCompare(b.display_name))
  .map((agent, i) => ({
    agent: { id: agent.id, display_name: agent.display_name },
    totals: eligibilityFor(i),
    months: months.map((month, m) => ({ month, ...eligibilityFor(i + m) })),
  }));

export function monthKpi(month: string, index: number) {
  const registrations = 240 + index * 12;
  const flagged = 14 + (index % 4);
  return {
    month,
    registrations,
    flagged,
    confirmed_fake: 4 + (index % 3),
    reviewed: flagged - 1,
    confirmed_real: flagged - 5 - (index % 3),
    eligible: registrations - flagged,
    flag_rate: flagged / registrations,
    confirmed_fake_rate: (4 + (index % 3)) / registrations,
    verification_rate: 0.68,
    avg_hours_to_review: 18 + index,
  };
}

export const networkKpis = {
  months: months.map(monthKpi),
  network_flag_rate: 0.058,
  min_registrations: 30,
  benchmark: agents
    .map((agent) => ({
      agent: { id: agent.id, display_name: agent.display_name },
      registrations: agent.n_users,
      flag_rate: agent.n_users >= 30 ? agent.flags / agent.n_users : null,
      difference:
        agent.n_users >= 30 ? agent.flags / agent.n_users - 0.058 : null,
      enough_data: agent.n_users >= 30,
      assisted_alert: agent.assisted_alert,
    }))
    .map((row, i) => ({ ...row, flag_rate: row.flag_rate ?? (i % 2) / 10 })),
};

// --- Mock handlers that page like the API ------------------------------------

export function pageOf<Row>(rows: Row[], url: URL, text: (row: Row) => string) {
  const term = (url.searchParams.get("q") ?? "").toLowerCase();
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 25);
  const matches = rows.filter(
    (row) => !term || text(row).toLowerCase().includes(term),
  );
  return {
    items: matches.slice(offset, offset + limit),
    total: matches.length,
  };
}

export function screenshotOverrides(legacy: boolean) {
  return {
    "GET /admin/agents": (url: URL) => {
      if (legacy) return { body: agents };
      const bands = url.searchParams.getAll("band");
      const rows = agents.filter(
        (agent) =>
          (!bands.length || bands.includes(agent.band)) &&
          (!url.searchParams.get("has_pending") || agent.pending_review > 0) &&
          (!url.searchParams.get("no_client") || agent.client === null),
      );
      return {
        body: pageOf(
          rows,
          url,
          (agent) => `${agent.display_name} ${agent.email}`,
        ),
      };
    },
    "GET /admin/agents/:id": (url: URL) => {
      const page = pageOf(
        customers,
        url,
        (row) => `${row.full_name} ${row.reference}`,
      );
      return {
        body: {
          ...agents[2],
          customers: page.items,
          customers_total: page.total,
        },
      };
    },
    "GET /admin/agents/:id/kpis": () => ({
      body: {
        agent: { id: agents[2].id, display_name: agents[2].display_name },
        months: months.map((month, i) => ({
          ...monthKpi(month, i),
          n_users_to_date: 8 * (i + 1),
          reputation: 91 - i / 3,
        })),
      },
    }),
    "GET /admin/kpis": () => ({ body: networkKpis }),
    "GET /admin/review-queue": (url: URL) => ({
      body: pageOf(
        queue.filter(
          (item) =>
            !url.searchParams.get("kind") ||
            (url.searchParams.get("kind") === "audit") === item.audit,
        ),
        url,
        (item) => `${item.customer_name} ${item.agent.display_name}`,
      ),
    }),
    "GET /admin/users": (url: URL) => ({
      body: pageOf(users, url, (row) => row.email),
    }),
    "GET /admin/audit-logs": (url: URL) => ({
      body: pageOf(auditLogs, url, (row) => `${row.action} ${row.request_id}`),
    }),
    "GET /admin/eligibility": (url: URL) => {
      const page = pageOf(
        eligibilityAgents,
        url,
        (row) => row.agent.display_name,
      );
      return {
        body: {
          totals: { eligible: 3104, pending: 33, not_eligible: 251 },
          months: months.map((month, i) => ({
            month,
            ...eligibilityFor(i * 3),
          })),
          agents: legacy ? eligibilityAgents : page.items,
          agents_total: page.total,
        },
      };
    },
    "GET /me/customers": (url: URL) => ({
      body: pageOf(
        customers.map((row) => ({
          full_name: row.full_name,
          registered_at: row.created_at,
          assisted: row.assisted,
        })),
        url,
        (row) => row.full_name,
      ),
    }),
    "GET /me/activity": () => ({
      body: {
        as_of: "2026-11-01",
        months: months.map((month, i) => ({
          month,
          registrations: i < 2 ? 6 + i : 14 + i,
          eligible: i < 2 ? null : 12 + i,
          awaiting_verification: i < 2 ? null : i % 3,
        })),
      },
    }),
    "GET /client/quality": () => ({
      body: {
        registrations: 1130,
        confirmed_fake: 21,
        confirmed_fake_percent: 1.9,
        under_review: 11,
        trend: months.map((month, i) => ({
          month,
          registrations: 80 + i * 6,
          confirmed_fake: 1 + (i % 3),
          confirmed_fake_percent: 1.8,
        })),
      },
    }),
    "GET /client/eligibility": () => ({
      body: {
        eligible: 1050,
        pending: 11,
        not_eligible: 69,
        agents: agents.slice(0, 14).map((agent, i) => ({
          display_name: agent.display_name,
          ...eligibilityFor(i),
        })),
      },
    }),
  };
}
