/**
 * Issue 194: `npm run db:comp <email> [url] [--production]` gives an existing member a comped Supper Club subscription:
 * real, on the pick list, never charged. The operator's tool (DEC-007, DEC-046): no screen, no repository method.
 *
 * It writes its own SQL in one transaction, after the reads the repository already has. Like `db:seed supper-club`
 * (db/seed.ts), a URL that is not local needs `--production`, and `--production` needs the URL.
 */
import { fileURLToPath } from "node:url";
import { createClient } from "../src/adapters/pg-connect.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { resolveChoices } from "../src/choices.js";
import { clevelandDate, firstPickup } from "../src/pickup-week.js";
import { requireSupperClub } from "../src/products.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";
import { assertLocalUrl } from "./seed.js";

/** The consent text stored on a comp's subscription. */
export const COMP_CONSENT_TEXT = "Comp subscription: never charged. Set by the operator with npm run db:comp.";

/** `<email> [url] [--production]`: the usage line with no email, and a refusal for `--production` with no URL, which never falls back to haul_dev. */
export function parseArgs(args: string[]): { email: string; url: string; production: boolean } {
  const production = args.includes("--production");
  const [email, url] = args.filter((arg) => arg !== "--production");
  if (!email) throw new Error("Usage: tsx db/comp.ts <email> [url] [--production].");
  if (production && !url) throw new Error("--production needs the database URL: it never defaults to haul_dev.");
  return { email, url: url ?? DEFAULT_DATABASE_URL, production };
}

/** Comps the member with the email, as of `now`; throws, writing nothing, when it must refuse. Returns the new subscription and its first week. */
export async function comp(args: string[], now: Date): Promise<{ subscriptionId: string; weekOf: string }> {
  const { email, url, production } = parseArgs(args);
  if (!production) assertLocalUrl(url);

  const repo = new PostgresRepository(url);
  try {
    const member = await repo.findMemberByEmail(email);
    if (!member) throw new Error(`Refusing to run: no member has the email ${email}. They sign in once first.`);
    const product = await requireSupperClub(repo);
    if (await repo.findActiveSubscription(member.id, product.id)) {
      throw new Error(`Refusing to run: ${email} already holds an active Supper Club subscription.`);
    }
    const { weekOf } = firstPickup(product, now, await repo.listChangedWeeks(product.id, clevelandDate(now)));
    const choices = resolveChoices(product, {});
    const typeIds = Object.keys(choices);

    const db = createClient(url);
    await db.connect();
    try {
      await db.query("begin");
      try {
        const { rows } = await db.query<{ id: string }>(
          `insert into subscriptions (member_id, product_id, status, comped, square_card_id, consent_text, consent_at, first_charge_cents, weekly_cents)
           values ($1, $2, 'active', true, null, $3, $4, 0, 0)
           returning id`,
          [member.id, product.id, COMP_CONSENT_TEXT, now],
        );
        const subscriptionId = rows[0]?.id;
        if (!subscriptionId) throw new Error("The comped subscription was not written.");
        await db.query(
          `insert into subscription_options (subscription_id, option_type_id, option_id, from_week)
           select $1, picked.option_type_id, picked.option_id, $4::date from unnest($2::uuid[], $3::uuid[]) as picked (option_type_id, option_id)`,
          [subscriptionId, typeIds, typeIds.map((typeId) => choices[typeId]), weekOf],
        );
        await db.query(
          `insert into ledger (subscription_id, pickup_date, amount_cents, status, attempt, paid_at)
           values ($1, $2::date, 0, 'paid', 1, $3)`,
          [subscriptionId, weekOf, now],
        );
        await db.query("commit");
        return { subscriptionId, weekOf };
      } catch (e) {
        // A rollback that fails too (the connection died) must not replace the original error.
        await db.query("rollback").catch(() => undefined);
        throw e;
      }
    } finally {
      await db.end();
    }
  } finally {
    await repo.close();
  }
}

// CLI: `tsx db/comp.ts <email> [url] [--production]`. Deliberately not DATABASE_URL, for the reason at db/migrate.ts:54-55.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  comp(args, new Date())
    .then(({ weekOf }) => console.log(`${parseArgs(args).email} is comped from ${weekOf}.`))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
