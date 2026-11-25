import { defineConfig, devices } from "@playwright/test";

// Accessibility and mobile checks in a real browser (Chromium), because the
// Vitest DOM cannot measure colour contrast or layout. Every API call is
// answered by e2e/mockApi.ts, so no backend, database, or Firebase is needed.
const port = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The narrowest common Android width; /join is used on phones.
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  // The production build, served by vite preview: the bundle users get, and
  // no first-load compile delays that make checks flaky.
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
    // Values set here take precedence over any local .env file, so the tests
    // never use real Firebase settings or a real API.
    env: {
      VITE_API_URL: "http://api.test",
      VITE_FIREBASE_API_KEY: "e2e-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "e2e.example.com",
      VITE_FIREBASE_PROJECT_ID: "e2e-project",
      VITE_FIREBASE_APP_ID: "e2e-app",
      VITE_PRIVACY_CONTACT_EMAIL: "privacy@example.com",
    },
  },
});
