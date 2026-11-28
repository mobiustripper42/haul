/**
 * The `members-list` seed (issue 263): the people the admin's members list needs beyond the `subscribers` seed's twelve
 * one-subscription members, for the list's rolldowns and the never-subscribed card.
 *
 * - Nia Okoro, a rejoiner: a cancelled subscription, and a later active one.
 * - Petra Lindqvist, twice gone: two cancelled subscriptions, the earlier holding a week credit never spent, so Refund
 *   owed shows in the rolldown and not on her row.
 * - Kit Vandermeer: a member who never confirmed their email and holds no subscription.
 *
 * It runs the `supper-club` seed first, so it needs nothing else loaded. Every row is upserted on a key of its own (a
 * member's email, a subscription's fixed id, a ledger row's subscription and pickup date, a week credit's ledger row) and
 * puts back only the columns it names, so a second run changes nothing and a row it does not name is left alone.
 */
import type { Client } from "../../src/adapters/pg-connect.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../../src/products.js";
import { seed as supperClub } from "./supper-club.js";

type Person = { email: string; firstName: string; lastName: string; phone: string };

type Held = {
  who: Person;
  /** The option names picked, one from each option type, in the order of the type. */
  picks: [size: string, menu: string];
  /** The day the first payment cleared, in Cleveland. */
  joined: string;
  /** The day it was cancelled; null for an active subscription. */
  cancelled: string | null;
  /** A week credit granted for the first paid week and never spent: a refund owed on a cancelled subscription. */
  unspentCredit?: boolean;
};

const NIA: Person = { email: "nia.okoro@example.com", firstName: "Nia", lastName: "Okoro", phone: "(216) 555-0173" };
const PETRA: Person = { email: "petra.lindqvist@example.com", firstName: "Petra", lastName: "Lindqvist", phone: "(440) 555-0156" };
const KIT = { email: "kit.vandermeer@example.com", firstName: "Kit", lastName: "Vandermeer", phone: "(216) 555-0138", createdAt: "2026-11-21T15:00:00Z" } as const;

const HELD: readonly Held[] = [
  { who: NIA, picks: ["Portioned for 2", "Vegan"], joined: "2026-11-03", cancelled: "2026-11-17" },
  { who: NIA, picks: ["Portioned for 4", "Standard"], joined: "2026-11-24", cancelled: null },
  { who: PETRA, picks: ["Portioned for 2", "Standard"], joined: "2026-10-05", cancelled: "2026-10-26", unspentCredit: true },
  { who: PETRA, picks: ["Portioned for 4", "Vegan"], joined: "2026-11-09", cancelled: "2026-11-30" },
];

/** A fixed subscription id for the nth subscription, apart from the `subscribers` seed's, so a second run finds the row it made. */
const subscriptionId = (n: number): string => `5eed1000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;

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
  const product = (
    await db.query<{ id: string; first_pickup: string }>(
      "select id, to_char(first_pickup_date, 'YYYY-MM-DD') as first_pickup from products where name = $1",
      [SUPPER_CLUB_PRODUCT_NAME],
    )
  ).rows[0];
  if (product === undefined) throw new Error("members-list seed: the Supper Club product is missing");
  const { id: productId, first_pickup: firstPickup } = product;
  const optionNamed = (name: string) => {
    const found = options.find((option) => option.name === name);
    if (!found) throw new Error(`members-list seed: the Supper Club has no option "${name}"`);
    return found;
  };

  // A member's `created_at` is set when the row is made and never put back, so the id and the date survive a second run.
  const memberIds = new Map<string, string>();
  for (const who of [NIA, PETRA]) {
    const first = HELD.find((held) => held.who === who);
    memberIds.set(who.email, await upsertMember(db, who, first ? `${first.joined}T17:00:00Z` : null, true));
  }
  await upsertMember(db, KIT, KIT.createdAt, false);

  for (const [n, held] of HELD.entries()) {
    const memberId = memberIds.get(held.who.email);
    if (memberId === undefined) throw new Error("members-list seed: a member's id is missing");
    const paidAt = `${held.joined}T17:00:00Z`;
    const cancelledAt = held.cancelled === null ? null : `${held.cancelled}T17:00:00Z`;
    const picked = held.picks.map(optionNamed);
    const cents = picked.reduce((sum, option) => sum + option.price_cents, 0);

    const id = subscriptionId(n);
    await db.query(
      `insert into subscriptions (id, member_id, product_id, status, cancelled_at, consent_text, consent_at, first_charge_cents, weekly_cents, created_at)
       values ($1, $2, $3, $7, $8::timestamptz, $4, $5, $6, $6, $5)
       on conflict (id) do update
         set member_id = excluded.member_id,
             product_id = excluded.product_id,
             status = excluded.status,
             cancelled_at = excluded.cancelled_at,
             consent_text = excluded.consent_text,
             consent_at = excluded.consent_at,
             first_charge_cents = excluded.first_charge_cents,
             weekly_cents = excluded.weekly_cents,
             created_at = excluded.created_at`,
      [id, memberId, productId, `I agree to a weekly charge of $${cents / 100} until I cancel.`, paidAt, cents, cancelledAt === null ? "active" : "cancelled", cancelledAt],
    );

    // The one set of picks, from the subscription's first ledger week, so every paid week reads it.
    await db.query("delete from subscription_options where subscription_id = $1 and from_week <> $2::date", [id, firstPickup]);
    for (const option of picked) {
      await db.query(
        `insert into subscription_options (subscription_id, option_type_id, option_id, from_week)
         values ($1, $2, $3, $4::date)
         on conflict (subscription_id, option_type_id, from_week) do update set option_id = excluded.option_id`,
        [id, option.type_id, option.id, firstPickup],
      );
    }

    const ledgerRow = await db.query<{ id: string }>(
      `insert into ledger (subscription_id, pickup_date, amount_cents, status, attempt, square_payment_id, paid_at)
       values ($1, $2, $3, 'paid', 1, $4, $5)
       on conflict (subscription_id, pickup_date) do update
         set amount_cents = excluded.amount_cents,
             status = excluded.status,
             attempt = excluded.attempt,
             square_payment_id = excluded.square_payment_id,
             paid_at = excluded.paid_at
       returning id`,
      [id, firstPickup, cents, `SEED_MEMBERS_LIST_PAYMENT_${n + 1}`, paidAt],
    );
    const ledgerId = ledgerRow.rows[0]?.id;
    if (ledgerId === undefined) throw new Error("members-list seed: the ledger upsert returned no id");
    if (!held.unspentCredit || cancelledAt === null) continue;

    // A week credit granted for the first paid week, with that week's picks, and never spent.
    const credit = await db.query<{ id: string }>(
      `insert into week_credits (subscription_id, granted_for, spent_on, granted_at)
       values ($1, $2, null, $3::timestamptz)
       on conflict (granted_for) do update set subscription_id = excluded.subscription_id, spent_on = excluded.spent_on, granted_at = excluded.granted_at
       returning id`,
      [id, ledgerId, cancelledAt],
    );
    const creditId = credit.rows[0]?.id;
    if (creditId === undefined) throw new Error("members-list seed: the week credit upsert returned no id");
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

/** One member, upserted on their email; `confirmed` makes the email confirmed at `createdAt`, and keeps an earlier time. */
async function upsertMember(db: Client, who: Person, createdAt: string | null, confirmed: boolean): Promise<string> {
  const member = await db.query<{ id: string }>(
    `insert into members (email, language, role, first_name, last_name, phone, email_confirmed_at, created_at)
     values ($1, 'en', 'member', $2, $3, $4, case when $6 then $5::timestamptz end, coalesce($5::timestamptz, now()))
     on conflict (email) do update
       set language = excluded.language,
           role = excluded.role,
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           phone = excluded.phone,
           email_confirmed_at = case when $6 then coalesce(members.email_confirmed_at, excluded.email_confirmed_at) else members.email_confirmed_at end
     returning id`,
    [who.email, who.firstName, who.lastName, who.phone, createdAt, confirmed],
  );
  const id = member.rows[0]?.id;
  if (id === undefined) throw new Error("members-list seed: the member upsert returned no id");
  return id;
}
