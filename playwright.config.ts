import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./e2e/database";

// e2e runs on one `next dev` server, not a prebuilt `next start` (DEC-023). Port 4100, so it starts
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
    url: `${baseURL}/sign-in`,
    reuseExistingServer: !ci,
    timeout: 120_000,
    env: {
      E2E: "1",
      // The origin the emailed sign-in link points at, which is the server this config starts.
      SITE_URL: baseURL,
      DATABASE_URL: e2eDatabaseUrl(),
      // Empty, so the app picks the dev fake and its outbox.
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
      // Empty, so the app picks the payments fake whatever .env.local holds; the browser has no Square.
      SQUARE_ACCESS_TOKEN: "",
      SQUARE_LOCATION_ID: "",
      SESSION_SECRET: "e2e-session-secret-not-for-use-0123456789",
    },
  },
});
