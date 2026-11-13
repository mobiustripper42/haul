/**
 * `npm run charge-run [-- --now <ISO instant>] [url]`: fires the charge run (issue 150, DEC-003, DEC-034) once, by hand,
 * and prints its `ChargeRunReport`. Nothing else calls `runCharges` yet: the cron route is task 2.3.
 *
 * Dev only, never in `verify` or CI. It runs on the local dev database at the URL `db/seed.ts` uses,
 * `DEFAULT_DATABASE_URL` or the one optional URL argument, and never `DATABASE_URL`, so an exported production URL is
 * never used (`db/seed.ts:90`, `db/migrate.ts:86-87`). Payments are `SquarePayments` when Square is configured and
 * `FakePayments` otherwise, as the app picks them; email is the fake that prints each message to the console.
 *
 * `--now` is the firing's `now` and where its `clock` starts, which then runs on from there; without it both are the
 * real clock.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FakeEmail } from "../src/adapters/fake-email.js";
import { FakePayments } from "../src/adapters/fake-payments.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { SquarePayments } from "../src/adapters/square-payments.js";
import { runCharges, type ChargeRunReport } from "../src/charge-run.js";
import type { PaymentsPort } from "../src/ports/payments.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";
import { assertLocalUrl } from "./seed.js";

// Copied from app/services.ts (getSiteUrl's dev default): `db/` cannot import `app/`.
const DEV_SITE_URL = "http://localhost:4000";
// Copied from app/paths.ts (ACCOUNT_PATH).
const ACCOUNT_PATH = "/account";

/** Square when its three variables are set, as `getPayments` in app/services.ts picks it, a fake otherwise. */
function paymentsFrom(env: NodeJS.ProcessEnv): PaymentsPort {
  const accessToken = env.SQUARE_ACCESS_TOKEN;
  const locationId = env.SQUARE_LOCATION_ID;
  if (!accessToken || !locationId) return new FakePayments();
  const environment = env.SQUARE_ENVIRONMENT;
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error('SQUARE_ENVIRONMENT must be "sandbox" or "production" when Square is configured');
  }
  return new SquarePayments({ accessToken, locationId, environment });
}

/** The `--now` instant and the one optional URL out of the arguments after the script's name. */
export function parseArgs(args: string[]): { now: Date | null; url: string } {
  let now: Date | null = null;
  let url = DEFAULT_DATABASE_URL;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--now") {
      const value = args[++i];
      const parsed = value === undefined ? new Date(Number.NaN) : new Date(value);
      if (Number.isNaN(parsed.getTime())) throw new Error("Usage: --now needs an ISO instant, e.g. --now 2027-01-19T05:00:01Z");
      now = parsed;
    } else if (arg !== undefined) {
      url = arg;
    }
  }
  return { now, url };
}

/** Fires the run once on the repository at `url`, and returns its report. */
export async function chargeRun({ now, url }: { now: Date | null; url: string }, env: NodeJS.ProcessEnv = process.env): Promise<ChargeRunReport> {
  assertLocalUrl(url);
  const repo = new PostgresRepository(url);
  try {
    const startedAt = Date.now();
    const start = now ?? new Date(startedAt);
    // The clock starts at `now` and runs on at the real pace, so `paid_at` follows the instant the firing was given.
    const clock = (): Date => new Date(start.getTime() + (Date.now() - startedAt));
    const siteUrl = env.SITE_URL || DEV_SITE_URL;
    return await runCharges({
      repo,
      payments: paymentsFrom(env),
      email: new FakeEmail({ onSend: (message) => console.log(`[email] to ${message.to}: ${message.subject}\n${message.text}`) }),
      now: start,
      clock,
      siteUrl,
      accountUrl: `${siteUrl.replace(/\/$/, "")}${ACCOUNT_PATH}`,
    });
  } finally {
    await repo.close();
  }
}

// CLI: `tsx db/charge-run.ts [--now <ISO instant>] [url]`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // The variables the app reads from .env.local, as db/square-sandbox-customers.ts loads its own.
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  chargeRun(parseArgs(process.argv.slice(2)))
    .then((report) => console.log(report))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
