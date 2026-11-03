// Answers every API call the pages make with the fixtures, so the browser
// checks need no backend. An unexpected call is recorded and fails the test,
// which keeps the mocks honest when a page starts using a new endpoint.
import type { Page, Route } from "@playwright/test";
import type { UserRole } from "../src/types/auth";
import * as data from "./fixtures";

export const API = "http://api.test";
const APP_ORIGIN = "http://localhost:4173";

type Reply = { status?: number; body?: unknown };
type Handler = (url: URL) => Reply;

const cors = {
  "access-control-allow-origin": APP_ORIGIN,
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization, content-type, accept",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const ok =
  (body: unknown): Handler =>
  () => ({ body });

function routes(role: UserRole | null): Record<string, Handler> {
  return {
    "POST /auth/refresh": () =>
      role
        ? {
            body: {
              access_token: `e2e-${role}`,
              token_type: "bearer",
              expires_in: 900,
            },
          }
        : {
            status: 401,
            body: {
              error: { code: "not_authenticated", message: "Sign in again." },
            },
          },
    "GET /auth/me": ok(role ? data.user(role) : null),
    "POST /auth/logout": () => ({ status: 204 }),
    "GET /admin/agents": ok(data.agents),
    "GET /admin/agents/:id": ok(data.agentDetail),
    "GET /admin/agents/:id/kpis": ok(data.agentKpis),
    "GET /admin/kpis": ok(data.networkKpis),
    "GET /admin/review-queue": ok(data.reviewQueue),
    "GET /admin/assessments/:id": ok(data.assessment),
    "GET /admin/eligibility": ok(data.eligibility),
    "GET /admin/scoring-config": ok(data.scoringConfig),
    "GET /admin/model": ok(data.modelStatus),
    "GET /admin/model/monitoring": ok(data.monitoring),
    "GET /admin/users": ok(data.users),
    "GET /admin/clients": ok(data.clients),
    "GET /admin/audit-logs": ok(data.auditLogs),
    "GET /me/referral": ok(data.referral),
    "GET /me/customers": ok(data.myCustomers),
    "GET /me/standing": ok(data.standing),
    "GET /me/activity": ok(data.activity),
    "GET /client/quality": ok(data.quality),
    "GET /client/eligibility": ok(data.clientEligibility),
    "GET /join/:id": (url) =>
      url.pathname.endsWith("/AGT-INACTIVE")
        ? {
            status: 404,
            body: {
              error: {
                code: "link_inactive",
                message: "This link is not active",
              },
            },
          }
        : { body: data.joinLink },
  };
}

function routeKey(method: string, pathname: string) {
  // Replace IDs and codes with :id so one entry matches every row.
  const path = pathname.replace(
    /^(\/(?:admin\/(?:agents|assessments|users|clients|customers)|join))\/[^/]+/,
    "$1/:id",
  );
  return `${method} ${path}`;
}

/**
 * Mock the API for one page. `role` null means signed out. Returns the list
 * of unexpected calls, which each test checks is empty.
 */
export async function mockApi(
  page: Page,
  role: UserRole | null,
  overrides: Record<string, Handler> = {},
) {
  const table = { ...routes(role), ...overrides };
  const unexpected: string[] = [];
  await page.route(`${API}/**`, async (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const url = new URL(request.url());
    const key = routeKey(request.method(), url.pathname);
    const handler = table[key];
    if (!handler) unexpected.push(key);
    const reply = handler
      ? handler(url)
      : { status: 404, body: { error: { message: "Not mocked" } } };
    await route.fulfill({
      status: reply.status ?? 200,
      headers: cors,
      contentType: "application/json",
      body: reply.body === undefined ? "" : JSON.stringify(reply.body),
    });
  });
  return unexpected;
}
