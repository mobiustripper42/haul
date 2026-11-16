/**
 * `npm run db:declined-card [email] [url]` (issue 196): sets one active subscription's `square_card_id` to the card
 * Square's sandbox and the fake both decline (`SQUARE_SANDBOX_VALUES.cardOnFileDeclined`), so the next charge run
 * declines it. By-hand tooling for the lock's recipe, not a seed: a seed must run alone from an emptied database
 * (`db/seed.test.ts`), and this one needs a subscription the app made. No test.
 *
 * With an email, that member's active subscription; without, the only active subscription, else it exits non-zero saying
 * how many it found. Local only, at the URL `db/charge-run.ts` uses (`DEFAULT_DATABASE_URL` or the one optional URL
 * argument), and re-runnable: a second run sets the same value.
 */
import { fileURLToPath } from "node:url";
import { createClient } from "../src/adapters/pg-connect.js";
import { SQUARE_SANDBOX_VALUES } from "../src/adapters/square-payments.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";
import { assertLocalUrl } from "./seed.js";

/** The optional member email and the optional database URL out of the arguments after the script's name: a URL carries `://`. */
export function parseArgs(args: string[]): { email: string | null; url: string } {
  let email: string | null = null;
  let url = DEFAULT_DATABASE_URL;
  for (const arg of args) {
    if (arg.includes("://")) url = arg;
    else email = arg;
  }
  return { email, url };
}

/** Points the chosen active subscription at the declining card, and returns the member's email it chose. */
export async function declinedCard({ email, url }: { email: string | null; url: string }): Promise<string> {
  assertLocalUrl(url);
  const db = createClient(url);
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string; email: string }>(
      `select s.id, m.email
         from subscriptions s join members m on m.id = s.member_id
        where s.status = 'active' and ($1::text is null or lower(m.email) = lower($1))
        order by s.created_at`,
      [email],
    );
    const found = rows[0];
    if (!found || rows.length > 1) {
      const which = email === null ? "active subscriptions" : `active subscriptions for ${email}`;
      throw new Error(`Expected exactly one of ${which}, found ${rows.length}. ${email === null ? "Pass the member's email." : ""}`.trim());
    }
    await db.query("update subscriptions set square_card_id = $2 where id = $1", [found.id, SQUARE_SANDBOX_VALUES.cardOnFileDeclined]);
    return found.email;
  } finally {
    await db.end();
  }
}

// CLI: `tsx db/declined-card.ts [email] [url]`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  declinedCard(parseArgs(process.argv.slice(2)))
    .then((email) => console.log(`${email}'s card on file is now the declined one.`))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
