import { FakeEmail } from "@core/adapters/fake-email.js";
import { FakePayments } from "@core/adapters/fake-payments.js";
import { PostgresRepository } from "@core/adapters/postgres-repository.js";
import { ResendEmail } from "@core/adapters/resend-email.js";
import { SquarePayments } from "@core/adapters/square-payments.js";
import { menuEmailWeekday } from "@core/menu-run.js";
import type { EmailPort } from "@core/ports/email.js";
import type { PaymentsPort } from "@core/ports/payments.js";
import type { Repository } from "@core/ports/repository.js";
import { sessionSecret } from "@core/sign-in/session.js";

// The app's one composition root: the only place that picks an adapter. Tests mock this module.

export const isProduction = (): boolean => process.env.NODE_ENV === "production";

// The local dev database (docker-compose.yml), the default db/migrate.ts uses.
const DEV_DATABASE_URL = "postgres://haul:haul@localhost:5434/haul_dev";

let repository: Repository | undefined;
let email: EmailPort | undefined;
let payments: PaymentsPort | undefined;

/** One `PostgresRepository` per server process, built on first call. */
export function getRepository(): Repository {
  if (!repository) {
    const url = process.env.DATABASE_URL || (isProduction() ? undefined : DEV_DATABASE_URL);
    if (!url) throw new Error("DATABASE_URL must be set in production");
    repository = new PostgresRepository(url);
  }
  return repository;
}

/**
 * The one dev `FakeEmail`, kept on `globalThis` and made on first call. Next loads this module once
 * for a server action and again for a route handler, so a module-level fake would be two lists;
 * the dev outbox route reads what the sign-in action sent because both reach this one.
 */
export function devEmail(): FakeEmail {
  const kept = globalThis as { __haulDevEmail?: FakeEmail };
  kept.__haulDevEmail ??= new FakeEmail({
    onSend: (message) => console.log(`[email] to ${message.to}: ${message.subject}\n${message.text}`),
  });
  return kept.__haulDevEmail;
}

/** Resend when it is configured; otherwise, outside production, a fake that prints each message to the server console. */
export function getEmail(): EmailPort {
  if (!email) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (apiKey && from) {
      email = new ResendEmail({ apiKey, from });
    } else if (!isProduction()) {
      email = devEmail();
    } else {
      throw new Error("RESEND_API_KEY and EMAIL_FROM must both be set in production");
    }
  }
  return email;
}

/**
 * Square when `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID` are both set, in `SQUARE_ENVIRONMENT`: which
 * must then be `sandbox` or `production`, in every environment, so a typo can never send a sandbox
 * charge to production or the reverse. Without them, a fake outside production, and in production a
 * throw, so a misconfigured production can never take a free signup.
 */
export function getPayments(): PaymentsPort {
  if (!payments) {
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;
    if (accessToken && locationId) {
      const environment = process.env.SQUARE_ENVIRONMENT;
      if (environment !== "sandbox" && environment !== "production") {
        throw new Error('SQUARE_ENVIRONMENT must be "sandbox" or "production" when Square is configured');
      }
      payments = new SquarePayments({ accessToken, locationId, environment });
    } else if (!isProduction()) {
      payments = new FakePayments();
    } else {
      throw new Error("SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID must both be set in production");
    }
  }
  return payments;
}

/** The day the weekly menu email goes out, from `MENU_EMAIL_WEEKDAY`, read at each call; throws unless it is 0 to 6 (issue 141). */
export function getMenuEmailWeekday(): number {
  return menuEmailWeekday({ MENU_EMAIL_WEEKDAY: process.env.MENU_EMAIL_WEEKDAY });
}

export function getSessionSecret(): string {
  return sessionSecret(process.env);
}

/** The address the sold-out card sends questions to. An empty `FARM_CONTACT_EMAIL` counts as unset. */
export function getFarmContactEmail(): string | undefined {
  return process.env.FARM_CONTACT_EMAIL || undefined;
}

const DEV_SITE_URL = "http://localhost:4000";

/** The site's address, for the links in emails. An empty `SITE_URL` counts as unset. In production it must be https, since the link carries a single-use token. */
export function getSiteUrl(): string {
  const url = process.env.SITE_URL || (isProduction() ? undefined : DEV_SITE_URL);
  if (!url) throw new Error("SITE_URL must be set in production");
  if (isProduction() && !url.startsWith("https://")) {
    throw new Error("SITE_URL must start with https:// in production");
  }
  return url;
}
