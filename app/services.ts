import { FakeEmail } from "@core/adapters/fake-email.js";
import { PostgresRepository } from "@core/adapters/postgres-repository.js";
import { ResendEmail } from "@core/adapters/resend-email.js";
import type { EmailPort } from "@core/ports/email.js";
import type { Repository } from "@core/ports/repository.js";
import { sessionSecret } from "@core/sign-in/session.js";

// The app's one composition root: the only place that picks an adapter. Tests mock this module.

export const isProduction = (): boolean => process.env.NODE_ENV === "production";

// The local dev database (docker-compose.yml), the default db/migrate.ts uses.
const DEV_DATABASE_URL = "postgres://haul:haul@localhost:5434/haul_dev";

let repository: Repository | undefined;
let email: EmailPort | undefined;

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

export function getSessionSecret(): string {
  return sessionSecret(process.env);
}
