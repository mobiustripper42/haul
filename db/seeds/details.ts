/**
 * The `details` seed (issue 156): the two members AC18's by-hand check of Your details needs, each with one active
 * Supper Club subscription and a paid ledger row, and no Square customer, so the check needs no Square sandbox.
 * `details.member@example.com` (Dana Details, English, a phone number) makes the changes; `details.taken@example.com`
 * is the address already in use for AC15. It runs the `supper-club` seed first, so it needs nothing else loaded.
 *
 * Both members have fixed ids, and a re-run puts back their email, name, phone and language and drops a change left
 * pending on them, so the check can start again after a change was confirmed. Its other rows are upserted on keys of
 * their own, so a second run changes nothing.
 */
import type { Client } from "../../src/adapters/pg-connect.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../../src/products.js";
import { seed as supperClub } from "./supper-club.js";

type Person = { id: string; subscriptionId: string; email: string; firstName: string; lastName: string; phone: string };

const PEOPLE: readonly Person[] = [
  {
    id: "5eed0156-0000-4000-8000-000000000001",
    subscriptionId: "5eed0156-0000-4000-8000-000000000101",
    email: "details.member@example.com",
    firstName: "Dana",
    lastName: "Details",
    phone: "(216) 555-0156",
  },
  {
    id: "5eed0156-0000-4000-8000-000000000002",
    subscriptionId: "5eed0156-0000-4000-8000-000000000102",
    email: "details.taken@example.com",
    firstName: "Terry",
    lastName: "Taken",
    phone: "(216) 555-0157",
  },
];

/** The day the first payment cleared; fixed, so a re-run stamps nothing new. */
const PAID_AT = "2026-12-01T17:00:00Z";

export async function seed(db: Client): Promise<void> {
  await supperClub(db);

  const product = (
    await db.query<{ id: string; first_pickup: string }>(
      "select id, to_char(first_pickup_date, 'YYYY-MM-DD') as first_pickup from products where name = $1",
      [SUPPER_CLUB_PRODUCT_NAME],
    )
  ).rows[0];
  if (product === undefined) throw new Error("details seed: the Supper Club product is missing");
  const { id: productId, first_pickup: firstPickup } = product;

  // One pick from each option type: the first option of each, by position.
  const { rows: picks } = await db.query<{ type_id: string; id: string; price_cents: number }>(
    `select distinct on (t.id) t.id as type_id, o.id, o.price_cents
       from option_types t
       join options o on o.option_type_id = t.id
      where t.product_id = $1
      order by t.id, o.position, o.name`,
    [productId],
  );
  const cents = picks.reduce((sum, pick) => sum + pick.price_cents, 0);

  for (const [n, who] of PEOPLE.entries()) {
    await db.query(
      `insert into members (id, email, language, role, first_name, last_name, phone, email_confirmed_at)
       values ($1, $2, 'en', 'member', $3, $4, $5, $6)
       on conflict (id) do update
         set email = excluded.email,
             language = excluded.language,
             role = excluded.role,
             first_name = excluded.first_name,
             last_name = excluded.last_name,
             phone = excluded.phone,
             email_confirmed_at = coalesce(members.email_confirmed_at, excluded.email_confirmed_at)`,
      [who.id, who.email, who.firstName, who.lastName, who.phone, PAID_AT],
    );
    await db.query("delete from email_changes where member_id = $1", [who.id]);

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
      [who.subscriptionId, who.id, productId, `I agree to a weekly charge of $${cents / 100} until I cancel.`, PAID_AT, cents],
    );

    for (const pick of picks) {
      await db.query(
        `insert into subscription_options (subscription_id, option_type_id, option_id, from_week)
         values ($1, $2, $3, $4::date)
         on conflict (subscription_id, option_type_id, from_week) do update set option_id = excluded.option_id`,
        [who.subscriptionId, pick.type_id, pick.id, firstPickup],
      );
    }

    await db.query(
      `insert into ledger (subscription_id, pickup_date, amount_cents, status, attempt, square_payment_id, paid_at)
       values ($1, $2, $3, 'paid', 1, $4, $5)
       on conflict (subscription_id, pickup_date) do update
         set amount_cents = excluded.amount_cents,
             status = excluded.status,
             attempt = excluded.attempt,
             square_payment_id = excluded.square_payment_id,
             paid_at = excluded.paid_at`,
      [who.subscriptionId, firstPickup, cents, `SEED_DETAILS_PAYMENT_${n + 1}`, PAID_AT],
    );
  }
}
