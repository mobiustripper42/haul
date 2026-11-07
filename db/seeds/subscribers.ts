/**
 * The `subscribers` seed (issue #59): twelve members, each holding one active Supper Club subscription with a
 * paid ledger row, across all four size-and-menu mixes, for the admin's members list and its spreadsheet. The
 * dates are fixed, each member joins on a different day, and none has a Square customer. It runs the
 * `supper-club` seed first, so it needs nothing else loaded.
 *
 * Every row is upserted on a key of its own (a member's email, a subscription's fixed id, a ledger row's
 * subscription and pickup date) and puts back only the columns it names, so a second run changes nothing and
 * a member or subscription it does not name is left alone.
 */
import type { Client } from "../../src/adapters/pg-connect.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../../src/products.js";
import { seed as supperClub } from "./supper-club.js";

type Subscriber = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  /** The option names picked, one from each option type, in the order of the type. */
  picks: [size: string, menu: string];
  /** The day the first payment cleared, in Cleveland. */
  joined: string;
};

const SUBSCRIBERS: readonly Subscriber[] = [
  { email: "chidi.abara@example.com", firstName: "Chidi", lastName: "Abara", phone: "(216) 555-0142", picks: ["3–4 people", "Standard"], joined: "2026-12-01" },
  { email: "rosa.bennett@example.com", firstName: "Rosa", lastName: "Bennett", phone: "(216) 555-0187", picks: ["2 people", "Vegan"], joined: "2026-12-01" },
  { email: "marco.castillo@example.com", firstName: "Marco", lastName: "Castillo", phone: "(440) 555-0123", picks: ["3–4 people", "Standard"], joined: "2026-12-02" },
  { email: "linh.dang@example.com", firstName: "Linh", lastName: "Dang", phone: "(216) 555-0166", picks: ["2 people", "Standard"], joined: "2026-12-02" },
  { email: "grace.ellison@example.com", firstName: "Grace", lastName: "Ellison", phone: "(216) 555-0119", picks: ["2 people", "Vegan"], joined: "2026-12-03" },
  { email: "yusuf.farah@example.com", firstName: "Yusuf", lastName: "Farah", phone: "(216) 555-0158", picks: ["3–4 people", "Standard"], joined: "2026-12-04" },
  { email: "ana.gutierrez@example.com", firstName: "Ana", lastName: "Gutierrez", phone: "(440) 555-0171", picks: ["3–4 people", "Vegan"], joined: "2026-12-05" },
  { email: "rami.haddad@example.com", firstName: "Rami", lastName: "Haddad", phone: "(216) 555-0134", picks: ["2 people", "Standard"], joined: "2026-12-07" },
  { email: "ben.kowalski@example.com", firstName: "Ben", lastName: "Kowalski", phone: "(216) 555-0149", picks: ["2 people", "Standard"], joined: "2026-12-08" },
  { email: "thandi.mbeki@example.com", firstName: "Thandi", lastName: "Mbeki", phone: "(216) 555-0195", picks: ["3–4 people", "Standard"], joined: "2026-12-09" },
  { email: "tam.nguyen@example.com", firstName: "Tam", lastName: "Nguyen", phone: "(216) 555-0110", picks: ["2 people", "Vegan"], joined: "2026-12-11" },
  { email: "ada.okafor@example.com", firstName: "Ada", lastName: "Okafor", phone: "(440) 555-0182", picks: ["3–4 people", "Standard"], joined: "2026-12-12" },
];

/** The first Sunday a signup pays for, which is the Supper Club seed's first pickup date. */
const FIRST_PICKUP = "2027-01-03";

/** A fixed subscription id for the nth subscriber, so a second run finds the row it made. */
const subscriptionId = (n: number): string => `5eed0000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;

export async function seed(db: Client): Promise<void> {
  await supperClub(db);

  const { rows: options } = await db.query<{ id: string; type_id: string; name: string; price_cents: number }>(
    `select o.id, o.option_type_id as type_id, o.name, o.price_cents
       from options o
       join option_types t on t.id = o.option_type_id
       join products p on p.id = t.product_id
      where p.name = $1`,
    [SUPPER_CLUB_PRODUCT_NAME],
  );
  const productId = (await db.query<{ id: string }>("select id from products where name = $1", [SUPPER_CLUB_PRODUCT_NAME])).rows[0]?.id;
  if (productId === undefined) throw new Error("subscribers seed: the Supper Club product is missing");
  const optionNamed = (name: string) => {
    const found = options.find((option) => option.name === name);
    if (!found) throw new Error(`subscribers seed: the Supper Club has no option "${name}"`);
    return found;
  };

  for (const [n, who] of SUBSCRIBERS.entries()) {
    const paidAt = `${who.joined}T17:00:00Z`;
    const picked = who.picks.map(optionNamed);
    const cents = picked.reduce((sum, option) => sum + option.price_cents, 0);

    const member = await db.query<{ id: string }>(
      `insert into members (email, language, role, first_name, last_name, phone, email_confirmed_at)
       values ($1, 'en', 'member', $2, $3, $4, $5)
       on conflict (email) do update
         set language = excluded.language,
             role = excluded.role,
             first_name = excluded.first_name,
             last_name = excluded.last_name,
             phone = excluded.phone,
             email_confirmed_at = coalesce(members.email_confirmed_at, excluded.email_confirmed_at)
       returning id`,
      [who.email, who.firstName, who.lastName, who.phone, paidAt],
    );
    const memberId = member.rows[0]?.id;
    if (memberId === undefined) throw new Error("subscribers seed: the member upsert returned no id");

    const id = subscriptionId(n);
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
      [id, memberId, productId, `I agree to a weekly charge of $${cents / 100} until I cancel.`, paidAt, cents],
    );

    for (const option of picked) {
      await db.query(
        `insert into subscription_options (subscription_id, option_type_id, option_id)
         values ($1, $2, $3)
         on conflict (subscription_id, option_type_id) do update set option_id = excluded.option_id`,
        [id, option.type_id, option.id],
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
      [id, FIRST_PICKUP, cents, `SEED_PAYMENT_${n + 1}`, paidAt],
    );
  }
}
