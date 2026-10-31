import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./e2e/database";

// e2e runs on one `next dev` server, not a prebuilt `next start` (DEC-021). Port 4100, so it starts
// beside `npm run dev` on 4000; next.config.ts gives it its own build directory when E2E is set.
const PORT = 4100;
const baseURL = `http://localhost:${PORT}`;
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    // Pixel 7 is Chromium with touch, so the phone gets `pointer: coarse` and the phone root size.
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: `./node_modules/.bin/next dev --webpack --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !ci,
    timeout: 120_000,
    env: {
      E2E: "1",
      DATABASE_URL: e2eDatabaseUrl(),
      // Empty, so the app picks the dev fake and its outbox.
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
      SESSION_SECRET: "e2e-session-secret-not-for-use-0123456789",
    },
  },
});
