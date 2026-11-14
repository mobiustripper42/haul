/**
 * `npm run menu-run [-- --now <ISO instant>] [url]`: fires the menu run (issue 141, DEC-036) once, by hand, and prints its
 * `MenuRunReport`. The cron route is `GET /api/menu-run`; this is the same run for a developer's terminal.
 *
 * Dev only, never in `verify` or CI. It runs on the local dev database at the URL `db/seed.ts` uses,
 * `DEFAULT_DATABASE_URL` or the one optional URL argument, and never `DATABASE_URL`, so an exported production URL is
 * never used (`db/seed.ts:90`, `db/migrate.ts:86-87`). Email is the fake that prints each message to the console.
 * `MENU_EMAIL_WEEKDAY` is read from the environment, `.env.local` included, as the route reads it.
 *
 * `--now` is the firing's `now`; without it, the real clock.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FakeEmail } from "../src/adapters/fake-email.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { menuEmailWeekday, runMenuRun, type MenuRunReport } from "../src/menu-run.js";
import { sessionSecret } from "../src/sign-in/session.js";
import { parseArgs } from "./charge-run.js";
import { assertLocalUrl } from "./seed.js";

// Copied from app/services.ts (getSiteUrl's dev default): `db/` cannot import `app/`.
const DEV_SITE_URL = "http://localhost:4000";
// Copied from app/paths.ts (ACCOUNT_WEEKS_PATH, ADMIN_WEEKS_PATH, MENU_PATH).
const ACCOUNT_WEEKS_PATH = "/account/weeks";
const ADMIN_WEEKS_PATH = "/admin/weeks";
const MENU_PATH = "/menu";

/** Fires the run once on the repository at `url`, and returns its report. */
export async function menuRun({ now, url }: { now: Date | null; url: string }, env: NodeJS.ProcessEnv = process.env): Promise<MenuRunReport> {
  assertLocalUrl(url);
  const emailWeekday = menuEmailWeekday(env);
  const repo = new PostgresRepository(url);
  try {
    const siteUrl = (env.SITE_URL || DEV_SITE_URL).replace(/\/$/, "");
    return await runMenuRun({
      repo,
      email: new FakeEmail({ onSend: (message) => console.log(`[email] to ${message.to}: ${message.subject}\n${message.text}`) }),
      now: now ?? new Date(),
      siteUrl,
      accountWeeksUrl: `${siteUrl}${ACCOUNT_WEEKS_PATH}`,
      adminWeeksUrl: `${siteUrl}${ADMIN_WEEKS_PATH}`,
      menuUrl: `${siteUrl}${MENU_PATH}`,
      emailWeekday,
      sessionSecret: sessionSecret(env),
    });
  } finally {
    await repo.close();
  }
}

// CLI: `tsx db/menu-run.ts [--now <ISO instant>] [url]`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // The variables the app reads from .env.local, as db/charge-run.ts loads its own.
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  menuRun(parseArgs(process.argv.slice(2)))
    .then((report) => console.log(report))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
