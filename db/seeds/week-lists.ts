/**
 * The `week-lists` seed (issue 142): the by-hand week for the admin's Weekly lists (AC10, AC11). It runs the `subscribers`
 * seed first, so it needs nothing else loaded, then writes the same state for two weeks, the select's default week
 * and the one before it, so a Final week is on hand whatever day it runs: of the twelve members, nine charged rows, one
 * row paid by a week credit granted for an earlier week and spent on it, one declined and one skipped. The roles rotate
 * by one member from the earlier week to the later, so each week has its own week credit and its own skip.
 *
 * The first week of the product is the `subscribers` seed's: its paid rows are never touched, so a run of that seed after
 * this one leaves this one's state as it was (db/seed.ts, AC5). A week's state is therefore written only for a week after
 * the first, and the week before the default is left out when the default is the first week. While the product has not
 * started the default week is the first, so the one week written is the week after it, which the select offers too.
 *
 * Every row is upserted on a key of its own (a ledger row's subscription and pickup date, a week credit's ledger row, a
 * credit's pick's type) and puts back only the columns it names. Every timestamp is derived from a week's date, never
 * from the clock, so a second run with the same default week changes nothing. A run on a day with another default week
 * rotates the roles, and a week credit spent on a row that is no longer the credit row stays spent: `db:reset:dev` first.
 */
import type { Client } from "../../src/adapters/pg-connect.js";
import { addDays, cutoffInstant, defaultListedWeek, listableWeeks } from "../../src/pickup-week.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../../src/products.js";
import { seed as subscribers } from "./subscribers.js";

/** The twelve members' roles in a week, in the `subscribers` seed's order: nine paid, then a credit, a decline and a skip. */
const ROLES = ["paid", "paid", "paid", "paid", "paid", "paid", "paid", "paid", "paid", "weekCredit", "declined", "skipped"] as const;

/** The nth subscriber's subscription id, as the `subscribers` seed gives it. */
const subscriptionId = (n: number): string => `5eed0000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;

export async function seed(db: Client): Promise<void> {
  await subscribers(db);

  const product = (
    await db.query<{ id: string; first_pickup: string; cutoff_weekday: number; cutoff_time: string }>(
      `select id, to_char(first_pickup_date, 'YYYY-MM-DD') as first_pickup, cutoff_weekday, cutoff_time::text as cutoff_time
         from products where name = $1`,
      [SUPPER_CLUB_PRODUCT_NAME],
    )
  ).rows[0];
  if (product === undefined) throw new Error("week-lists seed: the Supper Club product is missing");
  const settings = {
    id: product.id,
    name: SUPPER_CLUB_PRODUCT_NAME,
    cap: 0,
    firstPickupDate: product.first_pickup,
    cutoffWeekday: product.cutoff_weekday,
    cutoffTime: product.cutoff_time,
    optionTypes: [],
  };

  const stored = await db.query<{ week_of: string; closed_at: Date | null; note: string | null; first_day: string | null; last_day: string | null }>(
    `select to_char(week_of, 'YYYY-MM-DD') as week_of, closed_at, note,
            to_char(first_day, 'YYYY-MM-DD') as first_day, to_char(last_day, 'YYYY-MM-DD') as last_day
       from pickup_weeks where product_id = $1`,
    [product.id],
  );
  const changed = stored.rows.map((row) => ({ weekOf: row.week_of, closedAt: row.closed_at, note: row.note, firstDay: row.first_day, lastDay: row.last_day }));
  const now = new Date();
  const listed = listableWeeks(settings, now, changed);
  const first = defaultListedWeek(settings, now, changed, listed)?.weekOf;
  if (first === undefined) throw new Error("week-lists seed: the Supper Club has no week to list");
  // The first week is the `subscribers` seed's: the week before the default is written only when it is after it, and a
  // default that is the first week gives way to the week after.
  const weeks = [addDays(first, -7), first].filter((week) => week > product.first_pickup);
  if (weeks.length === 0) weeks.push(addDays(first, 7));

  const { rows: weekly } = await db.query<{ id: string; weekly_cents: number }>("select id, weekly_cents from subscriptions where id = any($1::uuid[])", [
    ROLES.map((_, n) => subscriptionId(n)),
  ]);
  const centsOf = (id: string): number => {
    const found = weekly.find((row) => row.id === id);
    if (!found) throw new Error(`week-lists seed: the subscription ${id} is missing`);
    return found.weekly_cents;
  };

  for (const [k, week] of weeks.entries()) {
    const chargedAt = cutoffInstant(settings, week).toISOString();
    for (const [n] of ROLES.entries()) {
      const id = subscriptionId(n);
      const role = ROLES[(n + k) % ROLES.length];
      const cents = centsOf(id);
      const status = role === "declined" ? "declined" : role === "skipped" ? "skipped" : "paid";
      const charged = role === "paid" || role === "declined" ? cents : 0;
      const row = await db.query<{ id: string }>(
        `insert into ledger (subscription_id, pickup_date, amount_cents, status, attempt, square_payment_id, paid_at)
         values ($1, $2::date, $3, $4, 1, $5, $6)
         on conflict (subscription_id, pickup_date) do update
           set amount_cents = excluded.amount_cents,
               status = excluded.status,
               attempt = excluded.attempt,
               square_payment_id = excluded.square_payment_id,
               paid_at = excluded.paid_at
         returning id`,
        [id, week, charged, status, role === "paid" ? `SEED_WEEK_LISTS_PAYMENT_${n + 1}_${week}` : null, status === "paid" ? chargedAt : null],
      );
      const rowId = row.rows[0]?.id;
      if (rowId === undefined) throw new Error("week-lists seed: the ledger upsert returned no id");
      if (role !== "weekCredit") continue;

      // A week credit granted for the subscription's first paid week, with that week's picks, spent on this row.
      const credit = await db.query<{ id: string }>(
        `insert into week_credits (subscription_id, granted_for, spent_on, granted_at)
         select $1, l.id, $3, $4::timestamptz from ledger l where l.subscription_id = $1 and l.pickup_date = $2::date
         on conflict (granted_for) do update set subscription_id = excluded.subscription_id, spent_on = excluded.spent_on, granted_at = excluded.granted_at
         returning id`,
        [id, product.first_pickup, rowId, cutoffInstant(settings, product.first_pickup).toISOString()],
      );
      const creditId = credit.rows[0]?.id;
      if (creditId === undefined) throw new Error("week-lists seed: the week credit upsert returned no id");
      await db.query(
        `insert into week_credit_options (week_credit_id, option_type_id, option_id)
         select $1, so.option_type_id, so.option_id from subscription_options so where so.subscription_id = $2 and so.from_week = $3::date
         on conflict (week_credit_id, option_type_id) do update set option_id = excluded.option_id`,
        [creditId, id, product.first_pickup],
      );
    }
  }
}
