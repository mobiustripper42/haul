/**
 * Dev script (issue 145): leaves a member's active subscription with a `declined` ledger row, the state a charge run's
 * decline would have left, so the by-hand checks of Update your card (AC10, AC11) have a week to retry. A decline is a
 * state nobody can click to make. It is a script, not a seed: it acts on a member made by hand, which a seed (db/seed.ts)
 * may not, and it touches no card and no customer, so the sandbox customer and card stand.
 *
 * `npm run db:declined-week <email> [url]`. The row is the subscription's weekly price for the first week, from its first
 * ledger row on, that has no row. A subscription already holding a declined row gets nothing more, so a second run adds
 * nothing. Local only: it refuses a URL whose host is not the dev box.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "../src/adapters/pg-connect.js";
import { addDays } from "../src/pickup-week.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../src/products.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";
import { assertLocalUrl } from "./seed.js";

/** The week the new declined row is for, or null when the subscription already holds a declined row. */
export type DeclinedWeekResult = { weekOf: string; amountCents: number } | null;

/** Writes the declined row for the active Supper Club subscription of the member with `email`, on the database at `url`. */
export async function declinedWeek({ email, url }: { email: string; url: string }): Promise<DeclinedWeekResult> {
  assertLocalUrl(url);
  const db = createClient(url);
  await db.connect();
  try {
    const { rows: found } = await db.query<{ id: string; weekly_cents: number }>(
      `select s.id, s.weekly_cents
         from subscriptions s
         join members m on m.id = s.member_id
         join products p on p.id = s.product_id
        where lower(m.email) = lower($1) and p.name = $2 and s.status = 'active'
        order by s.created_at desc
        limit 1`,
      [email, SUPPER_CLUB_PRODUCT_NAME],
    );
    const subscription = found[0];
    if (!subscription) throw new Error(`${email} has no active Supper Club subscription on this database.`);
    const { rows } = await db.query<{ pickup_date: string; status: string }>(
      "select to_char(pickup_date, 'YYYY-MM-DD') as pickup_date, status from ledger where subscription_id = $1 order by pickup_date",
      [subscription.id],
    );
    if (rows.some((row) => row.status === "declined")) return null;
    const first = rows[0]?.pickup_date;
    if (first === undefined) throw new Error(`${email}'s subscription has no ledger row to count weeks from.`);
    const taken = new Set(rows.map((row) => row.pickup_date));
    let weekOf = first;
    while (taken.has(weekOf)) weekOf = addDays(weekOf, 7);
    await db.query("insert into ledger (subscription_id, pickup_date, amount_cents, status) values ($1, $2, $3, 'declined')", [
      subscription.id,
      weekOf,
      subscription.weekly_cents,
    ]);
    return { weekOf, amountCents: subscription.weekly_cents };
  } finally {
    await db.end();
  }
}

// CLI: `tsx db/declined-week.ts <email> [url]`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const [email, url = DEFAULT_DATABASE_URL] = process.argv.slice(2);
  (email === undefined ? Promise.reject(new Error("Usage: npm run db:declined-week <email> [url]")) : declinedWeek({ email, url }))
    .then((result) =>
      console.log(result === null ? "Nothing added: that subscription already holds a declined row." : `Declined row added for the week of ${result.weekOf}, ${result.amountCents} cents.`),
    )
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
