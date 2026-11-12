/**
 * The `account-weeks` seed (issue 155): one member, `weeks.member@example.com`, with an active Supper Club
 * subscription, paid weeks from October 25, 2026, a closed week with no charge, and the latest past week closed
 * after it was paid with its week credit, for AC10's by-hand check of Upcoming weeks and History. It runs the
 * `supper-club` seed first, so it needs nothing else loaded, and changes no product column.
 *
 * Dates are worked out from now, as the `pickup-weeks` seed does, so it works whatever day it runs: paid ledger
 * rows for every week from the product's first pickup through the latest week whose cutoff has passed, except one
 * past week, which is closed with no charge; and the latest past week ("past" as History's rule: its last pickup
 * day has passed) closed after it was paid, with the week credit `closePickupWeek` would have granted, written as
 * rows: a seed holds only the transaction's client, and the repository opens a pool of its own. Nothing from the
 * next cutoff on is touched, so the admin calendar or SQL can close, reopen and move those weeks and both pages
 * follow.
 *
 * Every row is upserted on a key of its own (the member's email, a fixed subscription id, a ledger row's
 * subscription and pickup date, a week's product and Sunday, a week credit's ledger row) and puts back only the
 * columns it names. Every timestamp is derived from a week's date, never from the clock, so a second run changes
 * nothing. A run on a later week clears the unspent week credit and closure an earlier run made for the week that
 * was then the latest past one, so only the new latest past week stands closed after it was paid.
 */
import type { Client } from "../../src/adapters/pg-connect.js";
import { cutoffInstant, pastWeeks } from "../../src/pickup-week.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../../src/products.js";
import { seed as supperClub } from "./supper-club.js";

const EMAIL = "weeks.member@example.com";
const PICKS = ["Portioned for 4", "Standard"];

/** A fixed subscription id, so a second run finds the row it made. The subscribers seed's run from …000000000001 to …00000000000c. */
const SUBSCRIPTION_ID = "5eed0000-0000-4000-8000-0000000000f1";

const DAY_MS = 24 * 60 * 60 * 1000;

const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export async function seed(db: Client): Promise<void> {
  await supperClub(db);

  const product = (
    await db.query<{ id: string; first_pickup: string; cutoff_weekday: number; cutoff_time: string }>(
      `select id, to_char(first_pickup_date, 'YYYY-MM-DD') as first_pickup, cutoff_weekday, cutoff_time::text as cutoff_time
         from products where name = $1`,
      [SUPPER_CLUB_PRODUCT_NAME],
    )
  ).rows[0];
  if (product === undefined) throw new Error("account-weeks seed: the Supper Club product is missing");
  const settings = {
    id: product.id,
    name: SUPPER_CLUB_PRODUCT_NAME,
    cap: 0,
    firstPickupDate: product.first_pickup,
    cutoffWeekday: product.cutoff_weekday,
    cutoffTime: product.cutoff_time,
    optionTypes: [],
  };

  const now = new Date();
  const charged: string[] = [];
  for (let sunday = product.first_pickup; cutoffInstant(settings, sunday).getTime() <= now.getTime(); sunday = addDays(sunday, 7)) charged.push(sunday);
  // The past weeks are History's (`pastWeeks`), so a week an admin moved is past when its moved last day is.
  const stored = await db.query<{ week_of: string; closed_at: Date | null; note: string | null; first_day: string | null; last_day: string | null }>(
    `select to_char(week_of, 'YYYY-MM-DD') as week_of, closed_at, note,
            to_char(first_day, 'YYYY-MM-DD') as first_day, to_char(last_day, 'YYYY-MM-DD') as last_day
       from pickup_weeks where product_id = $1`,
    [product.id],
  );
  const changed = stored.rows.map((row) => ({ weekOf: row.week_of, closedAt: row.closed_at, note: row.note, firstDay: row.first_day, lastDay: row.last_day }));
  const past = pastWeeks(settings, now, changed, product.first_pickup)
    .map((week) => week.weekOf)
    .reverse();
  const latestPast = past.at(-1);
  // A past week that is neither the signup's nor the latest: closed with no charge.
  const closedUnpaid = past.length >= 3 ? past[1] : undefined;

  const { rows: options } = await db.query<{ id: string; type_id: string; name: string; price_cents: number }>(
    `select o.id, o.option_type_id as type_id, o.name, o.price_cents
       from options o
       join option_types t on t.id = o.option_type_id
      where t.product_id = $1`,
    [product.id],
  );
  const picked = PICKS.map((name) => {
    const found = options.find((option) => option.name === name);
    if (!found) throw new Error(`account-weeks seed: the Supper Club has no option "${name}"`);
    return found;
  });
  const cents = picked.reduce((sum, option) => sum + option.price_cents, 0);

  // The signup's payment cleared at the end of its cutoff day, as every later week's does.
  const chargedAt = (week: string): string => cutoffInstant(settings, week).toISOString();
  const signupAt = chargedAt(product.first_pickup);

  const member = await db.query<{ id: string }>(
    `insert into members (email, language, role, first_name, last_name, phone, email_confirmed_at)
     values ($1, 'en', 'member', 'Weeks', 'Member', '(216) 555-0155', $2)
     on conflict (email) do update
       set language = excluded.language,
           role = excluded.role,
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           phone = excluded.phone,
           email_confirmed_at = coalesce(members.email_confirmed_at, excluded.email_confirmed_at)
     returning id`,
    [EMAIL, signupAt],
  );
  const memberId = member.rows[0]?.id;
  if (memberId === undefined) throw new Error("account-weeks seed: the member upsert returned no id");

  await db.query(
    `insert into subscriptions (id, member_id, product_id, status, consent_text, consent_at, first_charge_cents, weekly_cents, created_at)
     values ($1, $2, $3, 'active', $4, $5, $6, $6, $5)
     on conflict (id) do update
       set member_id = excluded.member_id,
           product_id = excluded.product_id,
           status = excluded.status,
           consent_text = excluded.consent_text,
           consent_at = excluded.consent_at,
           first_charge_cents = excluded.first_charge_cents,
           weekly_cents = excluded.weekly_cents,
           created_at = excluded.created_at`,
    [SUBSCRIPTION_ID, memberId, product.id, `I agree to a weekly charge of $${cents / 100} until I cancel.`, signupAt, cents],
  );

  // The one set of picks, from the subscription's first ledger week (the signup's), so every paid week reads it. A
  // run after a switch starts the member over from it: a set from any other week is deleted.
  await db.query("delete from subscription_options where subscription_id = $1 and from_week <> $2::date", [SUBSCRIPTION_ID, product.first_pickup]);
  for (const option of picked) {
    await db.query(
      `insert into subscription_options (subscription_id, option_type_id, option_id, from_week)
       values ($1, $2, $3, $4::date)
       on conflict (subscription_id, option_type_id, from_week) do update set option_id = excluded.option_id`,
      [SUBSCRIPTION_ID, option.type_id, option.id, product.first_pickup],
    );
  }

  for (const week of charged) {
    if (week === closedUnpaid) continue;
    await db.query(
      `insert into ledger (subscription_id, pickup_date, amount_cents, status, attempt, square_payment_id, paid_at)
       values ($1, $2::date, $3, 'paid', 1, $4, $5)
       on conflict (subscription_id, pickup_date) do update
         set amount_cents = excluded.amount_cents,
             status = excluded.status,
             attempt = excluded.attempt,
             square_payment_id = excluded.square_payment_id,
             paid_at = excluded.paid_at`,
      [SUBSCRIPTION_ID, week, cents, `SEED_WEEKS_PAYMENT_${week}`, chargedAt(week)],
    );
  }

  const close = async (week: string, closedAt: string, note: string): Promise<void> => {
    await db.query(
      `insert into pickup_weeks (product_id, week_of, closed_at, note)
       values ($1, $2::date, $3, $4)
       on conflict (product_id, week_of) do update set closed_at = excluded.closed_at, note = excluded.note`,
      [product.id, week, closedAt, note],
    );
  };

  // Closed before its cutoff and never paid: three days ahead of it.
  if (closedUnpaid !== undefined) {
    await close(closedUnpaid, new Date(cutoffInstant(settings, closedUnpaid).getTime() - 3 * DAY_MS).toISOString(), "Closed before its cutoff, no charge (dev seed)");
  }

  // An earlier run's week credit, for a week that is no longer the latest past week, and the closure that went
  // with it: cleared, so one week at a time stands closed after it was paid. A spent credit is the charge run's,
  // not the seed's, and stays with its closure. A closure row holding a move keeps the move.
  const cleared = await db.query<{ week: string }>(
    `delete from week_credits c using ledger l
      where l.id = c.granted_for and c.subscription_id = $1 and c.spent_on is null and l.pickup_date is distinct from $2::date
      returning to_char(l.pickup_date, 'YYYY-MM-DD') as week`,
    [SUBSCRIPTION_ID, latestPast ?? null],
  );
  if (cleared.rows.length > 0) {
    const weeks = cleared.rows.map((row) => row.week);
    await db.query("delete from pickup_weeks where product_id = $1 and week_of = any($2::date[]) and first_day is null", [product.id, weeks]);
    await db.query("update pickup_weeks set closed_at = null, note = null where product_id = $1 and week_of = any($2::date[])", [product.id, weeks]);
  }

  // Closed after it was paid, on its first pickup day at noon: the week credit closing it would have granted.
  if (latestPast !== undefined) {
    const closedAt = `${latestPast}T16:00:00Z`;
    await close(latestPast, closedAt, "Closed after it was paid, a week credit (dev seed)");
    const credit = await db.query<{ id: string }>(
      `insert into week_credits (subscription_id, granted_for, granted_at)
       select $1, l.id, $3::timestamptz from ledger l where l.subscription_id = $1 and l.pickup_date = $2::date
       on conflict (granted_for) do update set subscription_id = excluded.subscription_id, granted_at = excluded.granted_at
       returning id`,
      [SUBSCRIPTION_ID, latestPast, closedAt],
    );
    const creditId = credit.rows[0]?.id;
    if (creditId === undefined) throw new Error("account-weeks seed: the week credit upsert returned no id");
    for (const option of picked) {
      await db.query(
        `insert into week_credit_options (week_credit_id, option_type_id, option_id)
         values ($1, $2, $3)
         on conflict (week_credit_id, option_type_id) do update set option_id = excluded.option_id`,
        [creditId, option.type_id, option.id],
      );
    }
  }
}
