import type { AccountDetails } from "../create-account.js";
import { DEFAULT_LANGUAGE, type Language } from "../i18n.js";
import { DEFAULT_ROLE, DuplicateEmailError, normalizeEmail, type Member, type Role } from "../members.js";
import type { Menu, MenuInput } from "../menus.js";
import {
  SignupRefusedError,
  type Actor,
  type AuditEvent,
  type EmailChange,
  type EnrolledWeek,
  type MemberSubscription,
  type MemberWeeks,
  type PendingCharge,
  type PendingSignup,
  type PendingSignupInput,
  type Repository,
  type SignupConfirmation,
  type Subscriber,
  type WeekCredit,
  type WeekDue,
} from "../ports/repository.js";
import { pickupWeek, type ChangedWeek } from "../pickup-week.js";
import { sameChoices } from "../switch-meal.js";
import { isSoldOut, type ProductOptionType, type ProductWithOptions } from "../products.js";
import { CODE_TTL_MS } from "../sign-in/code.js";
import type { SaveHold, SignInCode } from "../sign-in/store.js";
import { createPool, type Pool, type PoolClient } from "./pg-connect.js";

type MemberRow = {
  id: string;
  email: string;
  language: Language;
  role: Role;
  created_at: Date;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email_confirmed_at: Date | null;
  square_customer_id: string | null;
};

const MEMBER_COLUMNS =
  "id, email, language, role, created_at, first_name, last_name, phone, email_confirmed_at, square_customer_id";

const toMember = (row: MemberRow): Member => ({
  id: row.id,
  email: row.email,
  language: row.language,
  role: row.role,
  createdAt: row.created_at,
  firstName: row.first_name,
  lastName: row.last_name,
  phone: row.phone,
  emailConfirmedAt: row.email_confirmed_at,
  squareCustomerId: row.square_customer_id,
});

type EmailChangeRow = { member_id: string; new_email: string; code_hash: string; expires_at: Date; attempts: number };

type ProductRow = {
  id: string;
  name: string;
  cap: number;
  first_pickup_date: string;
  cutoff_weekday: number;
  cutoff_time: string;
};

type OptionRow = {
  option_type_id: string;
  option_type_name: string;
  option_type_position: number;
  option_type_menu_texts: boolean;
  option_id: string | null;
  option_name: string | null;
  price_cents: number | null;
  option_position: number | null;
};

type PendingSignupRow = {
  subscription_id: string;
  ledger_id: string;
  ledger_status: PendingSignup["ledgerStatus"];
  attempt: number;
  square_card_id: string | null;
  amount_cents: number;
  weekly_cents: number;
  pickup_date: string;
  created_at: Date;
  option_ids: string[];
};

type SignInCodeRow = {
  member_id: string;
  code_hash: string;
  created_at: Date;
  expires_at: Date;
  attempts: number;
  consumed_at: Date | null;
  failed_since: Date | null;
  failed_in_window: number;
  link_hash: string | null;
  link_created_at: Date | null;
  link_expires_at: Date | null;
};

const toSignInCode = (row: SignInCodeRow): SignInCode => ({
  subjectId: row.member_id,
  codeHash: row.code_hash,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  attempts: row.attempts,
  consumedAt: row.consumed_at,
  failedSince: row.failed_since,
  failedInWindow: row.failed_in_window,
  linkHash: row.link_hash,
  linkCreatedAt: row.link_created_at,
  linkExpiresAt: row.link_expires_at,
});

// The shape Postgres accepts for a uuid parameter, any version.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A timestamptz column as its day in Cleveland, `YYYY-MM-DD`. Only ever given a column name written in this file. */
const clevelandDay = (column: string): string => `to_char(${column} at time zone 'America/New_York', 'YYYY-MM-DD')`;

/**
 * A `where` condition on `subscription_options so`: the row belongs to the set in effect for the week `weekExpr` gives
 * (DEC-033), the set with the latest `from_week` on or before it. The one home of the rule, used by `listMemberWeeks`,
 * `grantWeekCredits` and `switchPicks`. `weekExpr` is only ever an expression written in this file.
 */
const inEffectFor = (weekExpr: string): string =>
  `so.from_week = (select max(latest.from_week) from subscription_options latest
                    where latest.subscription_id = so.subscription_id and latest.from_week <= ${weekExpr})`;

/**
 * Issue 150, AC6: a `select` of `option_type_id, option_id`, the picks of the paid ledger row `ledgerExpr` (a uuid
 * expression): those of the week credit spent on it when there is one, else the set in effect for the row's week
 * (DEC-033). The one home of the rule, used by `listMemberWeeks` and `grantWeekCredits`; used as
 * `join lateral (${rowPicks("l.id")}) picks on true`. `ledgerExpr` is only ever an expression written in this file.
 */
const rowPicks = (ledgerExpr: string): string =>
  `select spent_options.option_type_id, spent_options.option_id
     from week_credit_options spent_options join week_credits spent_credit on spent_credit.id = spent_options.week_credit_id
    where spent_credit.spent_on = ${ledgerExpr}
   union all
   select so.option_type_id, so.option_id
     from ledger picked_row join subscription_options so on so.subscription_id = picked_row.subscription_id
    where picked_row.id = ${ledgerExpr} and ${inEffectFor("picked_row.pickup_date")}
      and not exists (select 1 from week_credits spent_credit where spent_credit.spent_on = ${ledgerExpr})`;

/**
 * A condition: the week `weekExpr` of the product `productExpr` is closed (`pickup_weeks.closed_at` set). The one home of
 * the rule, used by `confirmSignupRows`, `enrolWeek`, `listPendingCharges` and `dropClosedWeekRow`. Both arguments are
 * only ever expressions written in this file.
 */
const weekClosed = (productExpr: string, weekExpr: string): string =>
  `exists (select 1 from pickup_weeks w where w.product_id = ${productExpr} and w.week_of = ${weekExpr} and w.closed_at is not null)`;

/**
 * A condition on `subscriptions s`: the subscription is due the week `weekParam` (`$n`) as of the cutoff instant
 * `cutoffParam` (`$n`), issue 134 AC1. It is `active`, or `cancelled` at or after the cutoff; the week is on or after the
 * first it paid for; and it has no `skipped` row for it. Whether it already holds a row for the week is `enrolWeek`'s
 * alone (its `on conflict`). The one home of the rule, shared by `listWeekDue` and `enrolWeek`.
 */
const dueAsOf = (weekParam: string, cutoffParam: string): string =>
  `((s.status = 'active' or (s.status = 'cancelled' and s.cancelled_at >= ${cutoffParam}::timestamptz))
    and (select min(l.pickup_date) from ledger l where l.subscription_id = s.id and l.status = 'paid') <= ${weekParam}::date
    and not exists (select 1 from ledger l where l.subscription_id = s.id and l.pickup_date = ${weekParam}::date and l.status = 'skipped'))`;

/** A `where` condition on `subscription_options so`: the row belongs to the subscription's newest set, whatever week it starts from. */
const NEWEST_SET = `so.from_week = (select max(newest.from_week) from subscription_options newest where newest.subscription_id = so.subscription_id)`;

/**
 * The hold both saves share, as a `where` clause appended to the statement (and its parameters): the
 * row holds an unused code, or an unused link, created less than `waitMs` before `now`. Empty
 * without a hold. `sign_in_codes.` is spelled out because an upsert's `where` also sees `excluded`.
 */
function holdWhere(hold: SaveHold | undefined, params: unknown[], keyword: "where" | "and" = "where"): string {
  if (!hold) return "";
  params.push(hold.now, hold.waitMs);
  const now = `$${params.length - 1}::timestamptz`;
  const wait = `$${params.length}::double precision * interval '1 millisecond'`;
  return `${keyword} not (
    (sign_in_codes.consumed_at is null and ${now} < sign_in_codes.created_at + ${wait})
    or (sign_in_codes.link_created_at is not null and ${now} < sign_in_codes.link_created_at + ${wait}))`;
}

/** What every query goes through: the pool, or inside `withActor` the transaction's one client. */
type Db = Pick<PoolClient, "query">;

/** `audit_log.actor` as text: `member:<uuid>` or `system:<name>`; empty for nobody, which reads back as null. */
const actorText = (actor: Actor): string => (actor === null ? "" : "member" in actor ? `member:${actor.member}` : `system:${actor.system}`);

export class PostgresRepository implements Repository {
  private readonly pool: Pool;
  private db: Db;
  // Set on the view `withActor` hands its function.
  private scoped = false;

  // TLS is applied inside the constructor, through `createPool`, per DEC-001.
  constructor(url: string) {
    this.pool = createPool(url);
    this.db = this.pool;
  }

  async createMember(input: { email: string; language?: Language; role?: Role }): Promise<Member> {
    const email = normalizeEmail(input.email);
    // `on conflict do nothing`, not a caught 23505: a failed statement aborts a `withActor` transaction,
    // and a duplicate email is an ordinary outcome the caller may catch and go on from. A concurrent
    // insert of the same email waits on the unique index and then conflicts here too, so none is raised.
    const { rows } = await this.db.query<MemberRow>(
      `insert into members (email, language, role) values ($1, $2, $3)
       on conflict (email) do nothing
       returning ${MEMBER_COLUMNS}`,
      [email, input.language ?? DEFAULT_LANGUAGE, input.role ?? DEFAULT_ROLE],
    );
    if (!rows[0]) throw new DuplicateEmailError(email);
    return toMember(rows[0]);
  }

  async findMemberByEmail(email: string): Promise<Member | null> {
    const { rows } = await this.db.query<MemberRow>(`select ${MEMBER_COLUMNS} from members where email = $1`, [
      normalizeEmail(email),
    ]);
    return rows[0] ? toMember(rows[0]) : null;
  }

  async findMemberById(id: string): Promise<Member | null> {
    // Checked here, not by catching 22P02: a failed query aborts a `withActor` transaction.
    if (!UUID_SHAPE.test(id)) return null;
    const { rows } = await this.db.query<MemberRow>(`select ${MEMBER_COLUMNS} from members where id = $1`, [id]);
    return rows[0] ? toMember(rows[0]) : null;
  }

  /**
   * One upsert: a new email inserts, an unconfirmed member's details are replaced, and a confirmed
   * member's row is left alone (the `where` fails, so no row change is written) and read back. The
   * unique index serialises callers that arrive together, so two never make two rows.
   */
  async saveAccount(input: AccountDetails): Promise<Member> {
    const email = normalizeEmail(input.email);
    const { rows } = await this.db.query<MemberRow>(
      `insert into members (email, first_name, last_name, phone, language) values ($1, $2, $3, $4, $5)
       on conflict (email) do update
         set first_name = excluded.first_name,
             last_name = excluded.last_name,
             phone = excluded.phone,
             language = excluded.language
         where members.email_confirmed_at is null
       returning ${MEMBER_COLUMNS}`,
      [email, input.firstName, input.lastName, input.phone, input.language],
    );
    if (rows[0]) return toMember(rows[0]);
    const confirmed = await this.findMemberByEmail(email);
    if (!confirmed) throw new Error("saveAccount: the member vanished between the upsert and the read");
    return confirmed;
  }

  async confirmMemberEmail(memberId: string, now: Date): Promise<void> {
    if (!UUID_SHAPE.test(memberId)) return;
    await this.db.query("update members set email_confirmed_at = $2 where id = $1 and email_confirmed_at is null", [
      memberId,
      now,
    ]);
  }

  async saveMemberDetails(memberId: string, details: { firstName: string; lastName: string; phone: string; language: Language }): Promise<Member> {
    const { rows } = await this.db.query<MemberRow>(
      `update members set first_name = $2, last_name = $3, phone = $4, language = $5 where id = $1 returning ${MEMBER_COLUMNS}`,
      [memberId, details.firstName, details.lastName, details.phone, details.language],
    );
    if (!rows[0]) throw new Error(`saveMemberDetails: no member ${memberId}`);
    return toMember(rows[0]);
  }

  async startEmailChange(input: { memberId: string; newEmail: string; codeHash: string; now: Date }): Promise<void> {
    await this.db.query(
      `insert into email_changes (member_id, new_email, code_hash, created_at, expires_at, attempts)
       values ($1, $2, $3, $4, $5, 0)
       on conflict (member_id) do update
         set new_email = excluded.new_email,
             code_hash = excluded.code_hash,
             created_at = excluded.created_at,
             expires_at = excluded.expires_at,
             attempts = 0`,
      [input.memberId, normalizeEmail(input.newEmail), input.codeHash, input.now, new Date(input.now.getTime() + CODE_TTL_MS)],
    );
  }

  async findEmailChange(memberId: string): Promise<EmailChange | null> {
    if (!UUID_SHAPE.test(memberId)) return null;
    const { rows } = await this.db.query<EmailChangeRow>(
      "select member_id, new_email, code_hash, expires_at, attempts from email_changes where member_id = $1",
      [memberId],
    );
    return rows[0]
      ? { memberId: rows[0].member_id, newEmail: rows[0].new_email, codeHash: rows[0].code_hash, expiresAt: rows[0].expires_at, attempts: rows[0].attempts }
      : null;
  }

  async countEmailChangeAttempt(memberId: string): Promise<number> {
    if (!UUID_SHAPE.test(memberId)) return 0;
    const { rows } = await this.db.query<{ attempts: number }>(
      "update email_changes set attempts = attempts + 1 where member_id = $1 returning attempts",
      [memberId],
    );
    return rows[0]?.attempts ?? 0;
  }

  /**
   * One statement: the pending row is deleted and its address becomes the member's email, confirmed at `now`. An
   * address another member holds changes nothing and leaves the row, raised as `DuplicateEmailError`. Guarded in the
   * statement rather than caught as a 23505, like `createMember`: a failed statement aborts a `withActor` transaction.
   */
  async applyEmailChange(memberId: string, now: Date): Promise<Member> {
    const { rows } = await this.db.query<MemberRow>(
      `with change as (select new_email from email_changes where member_id = $1),
            applied as (
              update members set email = change.new_email, email_confirmed_at = $2
                from change
               where members.id = $1
                 and not exists (select 1 from members other where other.email = change.new_email and other.id <> $1)
              returning ${MEMBER_COLUMNS.split(", ").map((column) => `members.${column}`).join(", ")}
            ),
            dropped as (delete from email_changes where member_id = $1 and exists (select 1 from applied))
       select * from applied`,
      [memberId, now],
    );
    if (rows[0]) return toMember(rows[0]);
    const pending = await this.findEmailChange(memberId);
    if (!pending) throw new Error(`applyEmailChange: no pending change for member ${memberId}`);
    throw new DuplicateEmailError(pending.newEmail);
  }

  async dropEmailChange(memberId: string): Promise<void> {
    if (!UUID_SHAPE.test(memberId)) return;
    await this.db.query("delete from email_changes where member_id = $1", [memberId]);
  }

  async findProductByName(name: string): Promise<ProductWithOptions | null> {
    const product = await this.db.query<ProductRow>(
      `select id, name, cap, to_char(first_pickup_date, 'YYYY-MM-DD') as first_pickup_date,
              cutoff_weekday, cutoff_time::text as cutoff_time
         from products where name = $1`,
      [name],
    );
    const row = product.rows[0];
    if (!row) return null;

    const { rows } = await this.db.query<OptionRow>(
      `select t.id as option_type_id, t.name as option_type_name, t.position as option_type_position,
              t.menu_texts as option_type_menu_texts,
              o.id as option_id, o.name as option_name, o.price_cents, o.position as option_position
         from option_types t
         left join options o on o.option_type_id = t.id
        where t.product_id = $1
        order by t.position, t.name, o.position, o.name`,
      [row.id],
    );
    const optionTypes: ProductOptionType[] = [];
    for (const r of rows) {
      let type = optionTypes.at(-1);
      if (type?.id !== r.option_type_id) {
        type = {
          id: r.option_type_id,
          name: r.option_type_name,
          position: r.option_type_position,
          menuTexts: r.option_type_menu_texts,
          options: [],
        };
        optionTypes.push(type);
      }
      if (r.option_id !== null) {
        type.options.push({
          id: r.option_id,
          name: r.option_name as string,
          priceCents: r.price_cents as number,
          position: r.option_position as number,
        });
      }
    }
    return {
      id: row.id,
      name: row.name,
      cap: row.cap,
      firstPickupDate: row.first_pickup_date,
      cutoffWeekday: row.cutoff_weekday,
      cutoffTime: row.cutoff_time,
      optionTypes,
    };
  }

  async setMemberSquareCustomer(memberId: string, customerId: string): Promise<void> {
    if (!UUID_SHAPE.test(memberId)) return;
    await this.db.query("update members set square_customer_id = $2 where id = $1", [memberId, customerId]);
  }

  async findActiveSubscription(memberId: string, productId: string): Promise<{ id: string } | null> {
    if (!UUID_SHAPE.test(memberId) || !UUID_SHAPE.test(productId)) return null;
    const { rows } = await this.db.query<{ id: string }>(
      "select id from subscriptions where member_id = $1 and product_id = $2 and status = 'active' order by created_at limit 1",
      [memberId, productId],
    );
    return rows[0] ? { id: rows[0].id } : null;
  }

  async findPendingSignup(memberId: string, productId: string): Promise<PendingSignup | null> {
    if (!UUID_SHAPE.test(memberId) || !UUID_SHAPE.test(productId)) return null;
    const { rows } = await this.db.query<PendingSignupRow>(
      `select s.id as subscription_id, l.id as ledger_id, l.status as ledger_status, l.attempt, s.square_card_id,
              l.amount_cents, s.weekly_cents, to_char(l.pickup_date, 'YYYY-MM-DD') as pickup_date, s.created_at,
              array(select so.option_id::text from subscription_options so where so.subscription_id = s.id) as option_ids
         from subscriptions s
         join ledger l on l.subscription_id = s.id
        where s.member_id = $1 and s.product_id = $2 and s.status = 'pending'
        order by l.pickup_date
        limit 1`,
      [memberId, productId],
    );
    const row = rows[0];
    return row
      ? {
          subscriptionId: row.subscription_id,
          ledgerId: row.ledger_id,
          ledgerStatus: row.ledger_status,
          attempt: row.attempt,
          squareCardId: row.square_card_id,
          amountCents: row.amount_cents,
          weeklyCents: row.weekly_cents,
          pickupDate: row.pickup_date,
          createdAt: row.created_at,
          optionIds: row.option_ids,
        }
      : null;
  }

  /**
   * The pending subscription, its picks and its ledger row, in one transaction under a lock on the member
   * row, which a bind and a confirm take too, so neither lands between the checks and the write. With the
   * lock held it refuses (`SignupRefusedError`) when the member holds an active subscription to the product,
   * or when the pending row has a card bound and its ledger row pending: that row is frozen. Otherwise the
   * upsert on the one-pending-row index makes a double submit one signup. A decline charged nothing, so the
   * row after one goes back to pending as the next attempt, with no card; a pending row keeps both.
   */
  async savePendingSignup(input: PendingSignupInput): Promise<PendingSignup> {
    if (!this.scoped) return this.withActor(null, (repo) => repo.savePendingSignup(input));
    await this.db.query("select id from members where id = $1 for update", [input.memberId]);
    const { rows: refusals } = await this.db.query<{ refused: boolean }>(
      `select exists (select 1 from subscriptions where member_id = $1 and product_id = $2 and status = 'active')
           or exists (select 1 from subscriptions s join ledger l on l.subscription_id = s.id
                       where s.member_id = $1 and s.product_id = $2 and s.status = 'pending'
                         and s.square_card_id is not null and l.status = 'pending') as refused`,
      [input.memberId, input.productId],
    );
    if (refusals[0]?.refused) throw new SignupRefusedError();
    const { rows } = await this.db.query<{ id: string }>(
      `insert into subscriptions (member_id, product_id, status, consent_text, consent_at, first_charge_cents, weekly_cents)
       values ($1, $2, 'pending', $3, $4, $5, $6)
       on conflict (member_id, product_id) where status = 'pending' do update
         set consent_text = excluded.consent_text,
             consent_at = excluded.consent_at,
             first_charge_cents = excluded.first_charge_cents,
             weekly_cents = excluded.weekly_cents
       returning id`,
      [input.memberId, input.productId, input.consentText, input.consentAt, input.firstChargeCents, input.weeklyCents],
    );
    const subscriptionId = (rows[0] as { id: string }).id;

    // The one set, at the ledger row's week. A pending subscription has no history, so a retry replaces it.
    const typeIds = Object.keys(input.choices);
    const optionIds = typeIds.map((typeId) => input.choices[typeId]);
    await this.db.query("delete from subscription_options where subscription_id = $1", [subscriptionId]);
    await this.db.query(
      `insert into subscription_options (subscription_id, option_type_id, option_id, from_week)
       select $1, picked.option_type_id, picked.option_id, $4::date from unnest($2::uuid[], $3::uuid[]) as picked (option_type_id, option_id)`,
      [subscriptionId, typeIds, optionIds, input.pickupDate],
    );

    const ledger = await this.db.query<{ id: string; status: string }>(
      "select id, status from ledger where subscription_id = $1 order by pickup_date limit 1 for update",
      [subscriptionId],
    );
    const earlier = ledger.rows[0];
    if (!earlier) {
      await this.db.query(
        "insert into ledger (subscription_id, pickup_date, amount_cents, status) values ($1, $2, $3, 'pending')",
        [subscriptionId, input.pickupDate, input.firstChargeCents],
      );
    } else {
      const declined = earlier.status === "declined";
      await this.db.query(
        `update ledger
            set pickup_date = $2,
                amount_cents = $3,
                status = case when $4::boolean then 'pending' else status end,
                attempt = case when $4::boolean then attempt + 1 else attempt end
          where id = $1`,
        [earlier.id, input.pickupDate, input.firstChargeCents, declined],
      );
      if (declined) await this.db.query("update subscriptions set square_card_id = null where id = $1", [subscriptionId]);
    }
    const saved = await this.findPendingSignup(input.memberId, input.productId);
    return saved as PendingSignup;
  }

  /**
   * Binds the card where the subscription is pending, has none and has its ledger row pending, and returns the
   * amount and attempt the same statement read from the ledger row: that is what the caller charges. No row, no
   * bind. The member row is locked first, then the product row, so two binds for the last spot take turns; a
   * confirm takes only the member lock, so the order cannot deadlock. The row's own state outranks the cap: a
   * row that cannot bind returns null before the count is read, and a full product returns "sold_out".
   */
  async saveSubscriptionCard(
    subscriptionId: string,
    cardId: string,
  ): Promise<{ amountCents: number; attempt: number } | "sold_out" | null> {
    if (!UUID_SHAPE.test(subscriptionId)) return null;
    if (!this.scoped) return this.withActor(null, (repo) => repo.saveSubscriptionCard(subscriptionId, cardId));
    await this.db.query(
      "select m.id from members m join subscriptions s on s.member_id = m.id where s.id = $1 for update of m",
      [subscriptionId],
    );
    const { rows: products } = await this.db.query<{ id: string; cap: number }>(
      "select p.id, p.cap from products p join subscriptions s on s.product_id = p.id where s.id = $1 for update of p",
      [subscriptionId],
    );
    const product = products[0];
    if (!product) return null;
    const { rows: bindable } = await this.db.query<{ id: string }>(
      `select s.id from subscriptions s join ledger l on l.subscription_id = s.id
        where s.id = $1 and s.status = 'pending' and s.square_card_id is null and l.status = 'pending'`,
      [subscriptionId],
    );
    if (!bindable[0]) return null;
    if (isSoldOut(product, await this.countHeldSpots(product.id))) return "sold_out";
    const { rows } = await this.db.query<{ amount_cents: number; attempt: number }>(
      `update subscriptions s set square_card_id = $2
         from ledger l
        where s.id = $1 and l.subscription_id = s.id and s.status = 'pending' and s.square_card_id is null and l.status = 'pending'
        returning l.amount_cents, l.attempt`,
      [subscriptionId, cardId],
    );
    return rows[0] ? { amountCents: rows[0].amount_cents, attempt: rows[0].attempt } : null;
  }

  async countHeldSpots(productId: string): Promise<number> {
    if (!UUID_SHAPE.test(productId)) return 0;
    const { rows } = await this.db.query<{ held: number }>(
      `select count(*)::int as held
         from subscriptions s
        where s.product_id = $1
          and (s.status = 'active'
               or (s.status = 'pending' and s.square_card_id is not null
                   and exists (select 1 from ledger l where l.subscription_id = s.id and l.status = 'pending')))`,
      [productId],
    );
    return rows[0]?.held ?? 0;
  }

  async recordSignupDecline(ledgerId: string): Promise<void> {
    if (!UUID_SHAPE.test(ledgerId)) return;
    await this.db.query("update ledger set status = 'declined' where id = $1 and status = 'pending'", [ledgerId]);
  }

  /**
   * Flips the ledger row and its subscription together, under the member row's lock: a concurrent confirm waits,
   * re-reads the row and finds it paid, so it says "already", whatever amount it brings. An amount that is not
   * the ledger's leaves both rows pending and says "mismatch". The product row is locked after the member row,
   * as closing a week locks it, so a confirmation that lands after its week closed sees the closure and grants
   * its week credit itself.
   */
  async confirmSignupRows(
    ledgerId: string,
    paymentId: string,
    amountCents: number,
    now: Date,
  ): Promise<"confirmed" | "already" | "mismatch"> {
    if (!UUID_SHAPE.test(ledgerId)) return "already";
    if (!this.scoped) return this.withActor(null, (repo) => repo.confirmSignupRows(ledgerId, paymentId, amountCents, now));
    await this.db.query(
      `select m.id from members m
         join subscriptions s on s.member_id = m.id
         join ledger l on l.subscription_id = s.id
        where l.id = $1 for update of m`,
      [ledgerId],
    );
    await this.db.query(
      `select p.id from products p
         join subscriptions s on s.product_id = p.id
         join ledger l on l.subscription_id = s.id
        where l.id = $1 for update of p`,
      [ledgerId],
    );
    const { rows: held } = await this.db.query<{ status: string; amount_cents: number; subscription_id: string }>(
      "select status, amount_cents, subscription_id from ledger where id = $1 for update",
      [ledgerId],
    );
    const row = held[0];
    if (!row || row.status === "paid") return "already";
    if (row.amount_cents !== amountCents) return "mismatch";
    await this.db.query("update ledger set status = 'paid', square_payment_id = $2, paid_at = $3 where id = $1", [
      ledgerId,
      paymentId,
      now,
    ]);
    // Only a signup's subscription turns active: a charge run's row on an active or a cancelled one leaves its status.
    await this.db.query("update subscriptions set status = 'active' where id = $1 and status = 'pending'", [row.subscription_id]);
    const { rows: weeks } = await this.db.query<{ product_id: string; pickup_date: string; closed: boolean }>(
      `select s.product_id, to_char(l.pickup_date, 'YYYY-MM-DD') as pickup_date,
              ${weekClosed("s.product_id", "l.pickup_date")} as closed
         from ledger l join subscriptions s on s.id = l.subscription_id
        where l.id = $1`,
      [ledgerId],
    );
    const week = weeks[0];
    if (week?.closed) await this.grantWeekCredits(week.product_id, week.pickup_date, now, ledgerId);
    return "confirmed";
  }

  async findSignupConfirmation(memberId: string, productId: string): Promise<SignupConfirmation | null> {
    return (await this.findSubscriptionOf(memberId, productId, ["active"]))?.confirmation ?? null;
  }

  async findMemberSubscription(memberId: string, productId: string): Promise<MemberSubscription | null> {
    const found = await this.findSubscriptionOf(memberId, productId, ["active", "cancelled"]);
    return found && { ...found.confirmation, status: found.status, cancelledAt: found.cancelledAt };
  }

  /** The member's newest subscription to the product with one of `statuses` and a paid row: its signup details, status and cancel time. */
  private async findSubscriptionOf(
    memberId: string,
    productId: string,
    statuses: ("active" | "cancelled")[],
  ): Promise<{ confirmation: SignupConfirmation; status: "active" | "cancelled"; cancelledAt: Date | null } | null> {
    if (!UUID_SHAPE.test(memberId) || !UUID_SHAPE.test(productId)) return null;
    const found = await this.db.query<{
      id: string;
      status: "active" | "cancelled";
      cancelled_at: Date | null;
      pickup_date: string;
      charged_date: string;
      first_charge_cents: number;
      weekly_cents: number;
      first_day: string | null;
      last_day: string | null;
    }>(
      `select s.id, s.status, s.cancelled_at, to_char(l.pickup_date, 'YYYY-MM-DD') as pickup_date, ${clevelandDay("l.paid_at")} as charged_date,
              s.first_charge_cents, s.weekly_cents,
              to_char(w.first_day, 'YYYY-MM-DD') as first_day, to_char(w.last_day, 'YYYY-MM-DD') as last_day
         from subscriptions s
         join ledger l on l.subscription_id = s.id
         left join pickup_weeks w on w.product_id = s.product_id and w.week_of = l.pickup_date
        where s.member_id = $1 and s.product_id = $2 and s.status = any($3::text[]) and l.paid_at is not null
        order by s.created_at desc, l.pickup_date
        limit 1`,
      [memberId, productId, statuses],
    );
    const row = found.rows[0];
    if (!row) return null;
    const week = pickupWeek(row.pickup_date, { weekOf: row.pickup_date, closedAt: null, note: null, firstDay: row.first_day, lastDay: row.last_day });
    const newest = (await this.optionsOf([row.id])).get(row.id);
    return {
      confirmation: {
        subscriptionId: row.id,
        pickupDate: row.pickup_date,
        firstDay: week.firstDay,
        lastDay: week.lastDay,
        chargedDate: row.charged_date,
        firstChargeCents: row.first_charge_cents,
        weeklyCents: row.weekly_cents,
        options: newest?.options ?? [],
        optionsFromWeek: newest?.fromWeek ?? "",
        choices: newest?.choices ?? {},
      },
      status: row.status,
      cancelledAt: row.cancelled_at,
    };
  }

  async cancelSubscription(subscriptionId: string, now: Date): Promise<boolean> {
    if (!UUID_SHAPE.test(subscriptionId)) return false;
    const { rowCount } = await this.db.query("update subscriptions set status = 'cancelled', cancelled_at = $2 where id = $1 and status = 'active'", [subscriptionId, now]);
    return rowCount === 1;
  }

  async listChangedWeeks(productId: string, from: string): Promise<ChangedWeek[]> {
    if (!UUID_SHAPE.test(productId)) return [];
    const { rows } = await this.db.query<{
      week_of: string;
      closed_at: Date | null;
      note: string | null;
      first_day: string | null;
      last_day: string | null;
    }>(
      `select to_char(week_of, 'YYYY-MM-DD') as week_of, closed_at, note,
              to_char(first_day, 'YYYY-MM-DD') as first_day, to_char(last_day, 'YYYY-MM-DD') as last_day
         from pickup_weeks
        where product_id = $1 and week_of >= $2::date
        order by week_of`,
      [productId, from],
    );
    return rows.map((row) => ({ weekOf: row.week_of, closedAt: row.closed_at, note: row.note, firstDay: row.first_day, lastDay: row.last_day }));
  }

  /**
   * An upsert on product and week: every column is replaced, so null reopens a week and clears a note. A week left
   * with nothing on it (not closed, not moved, no note) has no row: no row is an ordinary week (DEC-030).
   */
  async savePickupWeek(productId: string, week: ChangedWeek): Promise<void> {
    if (week.closedAt === null && week.note === null && week.firstDay === null && week.lastDay === null) {
      await this.db.query("delete from pickup_weeks where product_id = $1 and week_of = $2::date", [productId, week.weekOf]);
      return;
    }
    await this.db.query(
      `insert into pickup_weeks (product_id, week_of, closed_at, note, first_day, last_day)
       values ($1, $2::date, $3, $4, $5::date, $6::date)
       on conflict (product_id, week_of) do update
         set closed_at = excluded.closed_at, note = excluded.note, first_day = excluded.first_day, last_day = excluded.last_day`,
      [productId, week.weekOf, week.closedAt, week.note, week.firstDay, week.lastDay],
    );
  }

  /**
   * One transaction under the product row's lock, the lock a signup's confirmation takes after the member's: the
   * week is closed, its closing time and days kept if it already was, and every `paid` ledger row for it gets its
   * week credit. A second close grants nothing new: a week credit is unique by the ledger row it answers for.
   */
  async closePickupWeek(productId: string, weekOf: string, note: string | null, now: Date): Promise<boolean> {
    if (!UUID_SHAPE.test(productId)) return false;
    if (!this.scoped) return this.withActor(null, (repo) => repo.closePickupWeek(productId, weekOf, note, now));
    await this.db.query("select id from products where id = $1 for update", [productId]);
    // Read under the lock, so two closes of one week cannot both find it open.
    const before = await this.db.query<{ closed: boolean }>(
      "select closed_at is not null as closed from pickup_weeks where product_id = $1 and week_of = $2::date",
      [productId, weekOf],
    );
    await this.db.query(
      `insert into pickup_weeks (product_id, week_of, closed_at, note)
       values ($1, $2::date, $3, $4)
       on conflict (product_id, week_of) do update
         set closed_at = coalesce(pickup_weeks.closed_at, excluded.closed_at), note = excluded.note`,
      [productId, weekOf, now, note],
    );
    await this.grantWeekCredits(productId, weekOf, now);
    return before.rows[0]?.closed !== true;
  }

  /**
   * Under the same lock: the week's week credits are deleted (their picks go with them), the closing and the
   * note are cleared, and the row is deleted when nothing is left on it.
   */
  async reopenPickupWeek(productId: string, weekOf: string): Promise<void> {
    if (!UUID_SHAPE.test(productId)) return;
    if (!this.scoped) return this.withActor(null, (repo) => repo.reopenPickupWeek(productId, weekOf));
    await this.db.query("select id from products where id = $1 for update", [productId]);
    await this.db.query(
      `delete from week_credits
        where granted_for in (select l.id from ledger l join subscriptions s on s.id = l.subscription_id
                               where s.product_id = $1 and l.pickup_date = $2::date)`,
      [productId, weekOf],
    );
    await this.db.query("update pickup_weeks set closed_at = null, note = null where product_id = $1 and week_of = $2::date", [productId, weekOf]);
    await this.db.query(
      `delete from pickup_weeks
        where product_id = $1 and week_of = $2::date and closed_at is null and note is null and first_day is null and last_day is null`,
      [productId, weekOf],
    );
  }

  /** The menus (all, or the one with `id`) with their texts keyed by option id, newest `updated_at` first. */
  private async readMenus(id: string | null): Promise<Menu[]> {
    const { rows } = await this.db.query<{ id: string; name: string; updated_at: Date; texts: Record<string, string> }>(
      `select m.id, m.name, m.updated_at,
              coalesce(jsonb_object_agg(t.option_id, t.text) filter (where t.option_id is not null), '{}'::jsonb) as texts
         from menus m
         left join menu_texts t on t.menu_id = m.id
        where $1::uuid is null or m.id = $1::uuid
        group by m.id
        order by m.updated_at desc, m.id`,
      [id],
    );
    return rows.map((row) => ({ id: row.id, name: row.name, texts: row.texts, updatedAt: row.updated_at }));
  }

  /** Issue 140: every menu, newest `updated_at` first. */
  async listMenus(): Promise<Menu[]> {
    return this.readMenus(null);
  }

  async findMenu(id: string): Promise<Menu | null> {
    if (!UUID_SHAPE.test(id)) return null;
    return (await this.readMenus(id))[0] ?? null;
  }

  /** The menu row and a row per text, in one transaction. */
  async createMenu(input: MenuInput): Promise<Menu> {
    if (!this.scoped) return this.withActor(null, (repo) => repo.createMenu(input));
    const { rows } = await this.db.query<{ id: string }>("insert into menus (name) values ($1) returning id", [input.name]);
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("createMenu: the insert returned no id");
    await this.insertMenuTexts(id, input.texts);
    const menu = await this.findMenu(id);
    if (!menu) throw new Error("createMenu: the menu vanished after the insert");
    return menu;
  }

  /** Replaces the name and the texts whole, in one transaction; null, writing nothing, for an unknown id. */
  async saveMenu(id: string, input: MenuInput): Promise<Menu | null> {
    if (!UUID_SHAPE.test(id)) return null;
    if (!this.scoped) return this.withActor(null, (repo) => repo.saveMenu(id, input));
    const { rowCount } = await this.db.query("update menus set name = $2, updated_at = now() where id = $1", [id, input.name]);
    if (rowCount !== 1) return null;
    await this.db.query("delete from menu_texts where menu_id = $1", [id]);
    await this.insertMenuTexts(id, input.texts);
    return this.findMenu(id);
  }

  private async insertMenuTexts(menuId: string, texts: Record<string, string>): Promise<void> {
    const entries = Object.entries(texts);
    if (entries.length === 0) return;
    await this.db.query("insert into menu_texts (menu_id, option_id, text) select $1, o, t from unnest($2::uuid[], $3::text[]) as x(o, t)", [
      menuId,
      entries.map(([optionId]) => optionId),
      entries.map(([, text]) => text),
    ]);
  }

  /** Week key → menu id, for the product's weeks from `from` on. */
  async listWeekMenus(productId: string, from: string): Promise<Map<string, string>> {
    if (!UUID_SHAPE.test(productId)) return new Map();
    const { rows } = await this.db.query<{ week_of: string; menu_id: string }>(
      `select to_char(week_of, 'YYYY-MM-DD') as week_of, menu_id from week_menus where product_id = $1 and week_of >= $2::date`,
      [productId, from],
    );
    return new Map(rows.map((row) => [row.week_of, row.menu_id]));
  }

  /** An upsert on product and week; null deletes the row. False, writing nothing, for a menu that is not there. */
  async assignWeekMenu(productId: string, weekOf: string, menuId: string | null): Promise<boolean> {
    if (!UUID_SHAPE.test(productId)) return false;
    if (menuId === null) {
      await this.db.query("delete from week_menus where product_id = $1 and week_of = $2::date", [productId, weekOf]);
      return true;
    }
    if (!UUID_SHAPE.test(menuId)) return false;
    const { rowCount } = await this.db.query(
      `insert into week_menus (product_id, week_of, menu_id)
       select $1, $2::date, m.id from menus m where m.id = $3
       on conflict (product_id, week_of) do update set menu_id = excluded.menu_id`,
      [productId, weekOf, menuId],
    );
    return rowCount === 1;
  }

  /**
   * A week credit for each `paid` ledger row of the product's subscriptions for the week that has none, granted at
   * `now`, with a copy of the row's picks beside it (`rowPicks`: DEC-033, and the spent week credit's for a row one paid); with `ledgerId`, for that row alone. The one home for
   * granting, called by closing and by a confirmation that lands after the week closed. The caller holds the
   * product row's lock.
   */
  private async grantWeekCredits(productId: string, weekOf: string, now: Date, ledgerId?: string): Promise<void> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into week_credits (subscription_id, granted_for, granted_at)
       select l.subscription_id, l.id, $3::timestamptz
         from ledger l join subscriptions s on s.id = l.subscription_id
        where s.product_id = $1 and l.pickup_date = $2::date and l.status = 'paid' and ($4::uuid is null or l.id = $4::uuid)
       on conflict (granted_for) do nothing
       returning id`,
      [productId, weekOf, now, ledgerId ?? null],
    );
    if (rows.length === 0) return;
    await this.db.query(
      `insert into week_credit_options (week_credit_id, option_type_id, option_id)
       select c.id, picks.option_type_id, picks.option_id
         from week_credits c
         join lateral (${rowPicks("c.granted_for")}) picks on true
        where c.id = any($1::uuid[])`,
      [rows.map((row) => row.id)],
    );
  }

  async listWeekCredits(productId: string, weekOf: string): Promise<WeekCredit[]> {
    if (!UUID_SHAPE.test(productId)) return [];
    const { rows } = await this.db.query<{
      id: string;
      subscription_id: string;
      granted_for: string;
      spent_on: string | null;
      granted_at: Date;
      option_ids: string[];
    }>(
      `select c.id, c.subscription_id, c.granted_for, c.spent_on, c.granted_at,
              array(select o.option_id::text from week_credit_options o where o.week_credit_id = c.id) as option_ids
         from week_credits c
         join ledger l on l.id = c.granted_for
         join subscriptions s on s.id = l.subscription_id
        where s.product_id = $1 and l.pickup_date = $2::date
        order by c.granted_at, c.id`,
      [productId, weekOf],
    );
    return rows.map((row) => ({
      id: row.id,
      subscriptionId: row.subscription_id,
      grantedFor: row.granted_for,
      spentOn: row.spent_on,
      grantedAt: row.granted_at,
      optionIds: row.option_ids,
    }));
  }

  async listWeekDue(productId: string, weekOf: string, cutoff: Date): Promise<WeekDue[]> {
    if (!UUID_SHAPE.test(productId)) return [];
    const { rows } = await this.db.query<MemberRow & { subscription_id: string; notice: WeekDue["notice"] }>(
      `select s.id as subscription_id, ${MEMBER_COLUMNS.split(", ").map((column) => `m.${column}`).join(", ")},
              case when exists (select 1 from ledger l where l.subscription_id = s.id and l.pickup_date = $2::date and l.status = 'paid')
                   then 'weekCredit' else 'noCharge' end as notice
         from subscriptions s
         join members m on m.id = s.member_id
        where s.product_id = $1
          and (exists (select 1 from ledger l where l.subscription_id = s.id and l.pickup_date = $2::date and l.status = 'paid')
               or ${dueAsOf("$2", "$3")})
        order by s.created_at, s.id`,
      [productId, weekOf, cutoff],
    );
    return rows.map((row) => ({ subscriptionId: row.subscription_id, member: toMember(row), notice: row.notice }));
  }

  /**
   * One statement: a row, attempt 1, for every subscription of the product due `weekOf` as of `cutoff`, none for a closed
   * week; a subscription already holding a row for the week is left as it is (issue 150). A subscription holding an unspent
   * week credit granted for an earlier week gets its row `paid` at 0 cents, `paid_at` the cutoff, with its oldest such week
   * credit spent on it (by the granted-for week, then the credit's id) whatever its picks sum to; else one whose picks
   * in effect for the week (DEC-033) sum to 0 cents gets the same row, spending nothing; any other gets a `pending` row at
   * the sum. The spend rides on the insert, so a row that conflicts spends nothing. Returns what it wrote, by kind.
   */
  async enrolWeek(productId: string, weekOf: string, cutoff: Date): Promise<EnrolledWeek> {
    if (!UUID_SHAPE.test(productId)) return { pending: 0, zeroCents: 0, byWeekCredit: [] };
    const { rows } = await this.db.query<{ ledger_id: string; member_id: string; status: string; by_credit: boolean }>(
      `with due as (
         select s.id as subscription_id, s.member_id, s.created_at, picked.cents,
                (select c.id from week_credits c join ledger granted on granted.id = c.granted_for
                  where c.subscription_id = s.id and c.spent_on is null and granted.pickup_date < $2::date
                  order by granted.pickup_date, c.id limit 1) as credit_id
           from subscriptions s
           cross join lateral (select sum(o.price_cents)::int as cents
                                 from subscription_options so join options o on o.id = so.option_id
                                where so.subscription_id = s.id and ${inEffectFor("$2::date")}) picked
          where s.product_id = $1 and ${dueAsOf("$2", "$3")}
            and not ${weekClosed("s.product_id", "$2::date")}
       ), inserted as (
         insert into ledger (subscription_id, pickup_date, amount_cents, status, attempt, paid_at)
         select subscription_id, $2::date,
                case when credit_id is not null then 0 else cents end,
                case when credit_id is not null or cents = 0 then 'paid' else 'pending' end,
                1,
                case when credit_id is not null or cents = 0 then $3::timestamptz end
           from due
          where credit_id is not null or cents is not null
          order by created_at, subscription_id
         on conflict (subscription_id, pickup_date) do nothing
         returning id, subscription_id, status
       ), spent as (
         update week_credits c set spent_on = inserted.id
           from due join inserted on inserted.subscription_id = due.subscription_id
          where c.id = due.credit_id and c.spent_on is null
         returning inserted.id as ledger_id
       )
       select inserted.id as ledger_id, due.member_id, inserted.status, (inserted.id in (select ledger_id from spent)) as by_credit
         from inserted join due on due.subscription_id = inserted.subscription_id
        order by due.created_at, due.subscription_id`,
      [productId, weekOf, cutoff],
    );
    return {
      pending: rows.filter((row) => row.status === "pending").length,
      zeroCents: rows.filter((row) => row.status === "paid" && !row.by_credit).length,
      byWeekCredit: rows.filter((row) => row.by_credit).map((row) => ({ ledgerId: row.ledger_id, memberId: row.member_id })),
    };
  }

  /**
   * The product's `pending` rows whose subscription has a card, and a member with a Square customer, oldest week first,
   * then the subscription's `created_at`: each with whether its week is closed and its week's last pickup day.
   */
  async listPendingCharges(productId: string): Promise<PendingCharge[]> {
    if (!UUID_SHAPE.test(productId)) return [];
    const { rows } = await this.db.query<{
      ledger_id: string;
      subscription_id: string;
      status: PendingCharge["subscriptionStatus"];
      member_id: string;
      customer_id: string;
      card_id: string;
      amount_cents: number;
      attempt: number;
      pickup_date: string;
      created_at: Date;
      closed: boolean;
      first_day: string | null;
      last_day: string | null;
    }>(
      `select l.id as ledger_id, s.id as subscription_id, s.status, s.member_id, m.square_customer_id as customer_id,
              s.square_card_id as card_id, l.amount_cents, l.attempt, to_char(l.pickup_date, 'YYYY-MM-DD') as pickup_date,
              s.created_at, ${weekClosed("s.product_id", "l.pickup_date")} as closed,
              to_char(w.first_day, 'YYYY-MM-DD') as first_day, to_char(w.last_day, 'YYYY-MM-DD') as last_day
         from ledger l
         join subscriptions s on s.id = l.subscription_id
         join members m on m.id = s.member_id
         left join pickup_weeks w on w.product_id = s.product_id and w.week_of = l.pickup_date
        where s.product_id = $1 and l.status = 'pending' and s.square_card_id is not null and m.square_customer_id is not null
        order by l.pickup_date, s.created_at, l.id`,
      [productId],
    );
    return rows.map((row) => ({
      ledgerId: row.ledger_id,
      subscriptionId: row.subscription_id,
      subscriptionStatus: row.status,
      memberId: row.member_id,
      customerId: row.customer_id,
      cardId: row.card_id,
      amountCents: row.amount_cents,
      attempt: row.attempt,
      pickupDate: row.pickup_date,
      createdAt: row.created_at,
      closed: row.closed,
      lastPickupDay: pickupWeek(row.pickup_date, { weekOf: row.pickup_date, closedAt: null, note: null, firstDay: row.first_day, lastDay: row.last_day }).lastDay,
    }));
  }

  /** Deletes the row when it is `pending`, its subscription is not `pending` and its week is closed. The date condition is the run's. */
  async dropClosedWeekRow(ledgerId: string): Promise<boolean> {
    if (!UUID_SHAPE.test(ledgerId)) return false;
    const { rowCount } = await this.db.query(
      `delete from ledger l using subscriptions s
        where l.id = $1 and s.id = l.subscription_id and l.status = 'pending' and s.status <> 'pending'
          and ${weekClosed("s.product_id", "l.pickup_date")}`,
      [ledgerId],
    );
    return rowCount === 1;
  }

  async listWeekCounts(productId: string, from: string): Promise<Map<string, { paid: number; weekCredits: number }>> {
    if (!UUID_SHAPE.test(productId)) return new Map();
    const { rows } = await this.db.query<{ week_of: string; paid: number; week_credits: number }>(
      `select to_char(l.pickup_date, 'YYYY-MM-DD') as week_of, count(*)::int as paid, count(c.id)::int as week_credits
         from ledger l
         join subscriptions s on s.id = l.subscription_id
         left join week_credits c on c.granted_for = l.id
        where s.product_id = $1 and l.pickup_date >= $2::date and l.status = 'paid'
        group by l.pickup_date`,
      [productId, from],
    );
    return new Map(rows.map((row) => [row.week_of, { paid: row.paid, weekCredits: row.week_credits }]));
  }

  async listMemberWeeks(subscriptionId: string): Promise<MemberWeeks> {
    if (!UUID_SHAPE.test(subscriptionId)) return { paid: [], weekCredits: [], skipped: [] };
    const [paid, paidOptions, weekCredits, skipped] = await Promise.all([
      this.db.query<{ week_of: string; amount_cents: number; week_credit: boolean }>(
        `select to_char(pickup_date, 'YYYY-MM-DD') as week_of, amount_cents,
                exists (select 1 from week_credits c where c.spent_on = ledger.id) as week_credit
           from ledger
          where subscription_id = $1 and status = 'paid'
          order by pickup_date`,
        [subscriptionId],
      ),
      this.db.query<{ week_of: string; type_name: string; option_name: string }>(
        `select to_char(l.pickup_date, 'YYYY-MM-DD') as week_of, t.name as type_name, o.name as option_name
           from ledger l
           join lateral (${rowPicks("l.id")}) picks on true
           join option_types t on t.id = picks.option_type_id
           join options o on o.id = picks.option_id
          where l.subscription_id = $1 and l.status = 'paid'
          order by t.position, t.name`,
        [subscriptionId],
      ),
      this.db.query<{ granted_for_week: string }>(
        `select to_char(l.pickup_date, 'YYYY-MM-DD') as granted_for_week
           from week_credits c
           join ledger l on l.id = c.granted_for
          where c.subscription_id = $1 and c.spent_on is null
          order by l.pickup_date, c.id`,
        [subscriptionId],
      ),
      this.db.query<{ week_of: string }>(
        `select to_char(pickup_date, 'YYYY-MM-DD') as week_of
           from ledger
          where subscription_id = $1 and status = 'skipped'
          order by pickup_date`,
        [subscriptionId],
      ),
    ]);
    return {
      paid: paid.rows.map((row) => ({
        weekOf: row.week_of,
        amountCents: row.amount_cents,
        weekCredit: row.week_credit,
        options: paidOptions.rows.filter((option) => option.week_of === row.week_of).map((option) => ({ typeName: option.type_name, optionName: option.option_name })),
      })),
      weekCredits: weekCredits.rows.map((row) => ({ grantedForWeek: row.granted_for_week })),
      skipped: skipped.rows.map((row) => row.week_of),
    };
  }

  async skipWeek(subscriptionId: string, weekOf: string): Promise<boolean> {
    // Checked here, not by catching 22P02 or 23503: a failed query aborts a `withActor` transaction. The `select`
    // makes an unknown subscription insert nothing, and `on conflict do nothing` a week that already has a row.
    if (!UUID_SHAPE.test(subscriptionId)) return false;
    const { rowCount } = await this.db.query(
      `insert into ledger (subscription_id, pickup_date, amount_cents, status)
       select id, $2::date, 0, 'skipped' from subscriptions where id = $1
       on conflict (subscription_id, pickup_date) do nothing`,
      [subscriptionId, weekOf],
    );
    return rowCount === 1;
  }

  async unskipWeek(subscriptionId: string, weekOf: string): Promise<boolean> {
    if (!UUID_SHAPE.test(subscriptionId)) return false;
    const { rowCount } = await this.db.query(
      `delete from ledger where subscription_id = $1 and pickup_date = $2::date and status = 'skipped'`,
      [subscriptionId, weekOf],
    );
    return rowCount === 1;
  }

  /**
   * One transaction under the subscription row's lock: every set from `fromWeek` on is deleted and the new one
   * inserted at it, unless it equals the set in effect for the week before (then it only deletes), and `weekly_cents`
   * is set. The sets ending as they were is "unchanged", and writes nothing, `weekly_cents` included.
   */
  async switchPicks(subscriptionId: string, choices: Record<string, string>, fromWeek: string, weeklyCents: number): Promise<"switched" | "unchanged"> {
    if (!UUID_SHAPE.test(subscriptionId)) return "unchanged";
    if (!this.scoped) return this.withActor(null, (repo) => repo.switchPicks(subscriptionId, choices, fromWeek, weeklyCents));
    const { rows: locked } = await this.db.query("select id from subscriptions where id = $1 for update", [subscriptionId]);
    if (locked.length === 0) return "unchanged";
    const [previous, stored] = await Promise.all([
      this.db.query<{ option_type_id: string; option_id: string }>(
        `select so.option_type_id, so.option_id from subscription_options so
          where so.subscription_id = $1 and ${inEffectFor("$2::date - 7")}`,
        [subscriptionId, fromWeek],
      ),
      this.db.query<{ from_week: string; option_type_id: string; option_id: string }>(
        `select to_char(from_week, 'YYYY-MM-DD') as from_week, option_type_id, option_id from subscription_options
          where subscription_id = $1 and from_week >= $2::date`,
        [subscriptionId, fromWeek],
      ),
    ]);
    const before = Object.fromEntries(previous.rows.map((row) => [row.option_type_id, row.option_id]));
    const insert = previous.rows.length === 0 || !sameChoices(before, choices);
    // What is stored from the switch week on would end as it was when it is exactly the one set to insert, or nothing.
    const storedWeeks = new Set(stored.rows.map((row) => row.from_week));
    const storedChoices = Object.fromEntries(stored.rows.map((row) => [row.option_type_id, row.option_id]));
    const unchanged = insert ? storedWeeks.size === 1 && storedWeeks.has(fromWeek) && sameChoices(storedChoices, choices) : storedWeeks.size === 0;
    if (unchanged) return "unchanged";
    await this.db.query("delete from subscription_options where subscription_id = $1 and from_week >= $2::date", [subscriptionId, fromWeek]);
    if (insert) {
      const typeIds = Object.keys(choices);
      await this.db.query(
        `insert into subscription_options (subscription_id, option_type_id, option_id, from_week)
         select $1, picked.option_type_id, picked.option_id, $4::date from unnest($2::uuid[], $3::uuid[]) as picked (option_type_id, option_id)`,
        [subscriptionId, typeIds, typeIds.map((typeId) => choices[typeId]), fromWeek],
      );
    }
    await this.db.query("update subscriptions set weekly_cents = $2 where id = $1", [subscriptionId, weeklyCents]);
    return "switched";
  }

  /**
   * The active and cancelled subscriptions to the product, each with its member and the date its first paid row was
   * paid, in Cleveland. A subscription with no paid row is left out: only a paid row makes one active. `refundOwed`
   * is a cancelled subscription holding a week credit not yet spent. Stable by the date joined, then by id.
   */
  async listSubscribers(productId: string): Promise<Subscriber[]> {
    if (!UUID_SHAPE.test(productId)) return [];
    const { rows } = await this.db.query<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string;
      phone: string | null;
      joined: string;
      status: "active" | "cancelled";
      refund_owed: boolean;
    }>(
      `select s.id, m.first_name, m.last_name, m.email, m.phone,
              ${clevelandDay("paid.first_paid_at")} as joined, s.status,
              (s.status = 'cancelled'
                and exists (select 1 from week_credits c where c.subscription_id = s.id and c.spent_on is null)) as refund_owed
         from subscriptions s
         join members m on m.id = s.member_id
         join lateral (
           select min(l.paid_at) as first_paid_at from ledger l
            where l.subscription_id = s.id and l.status = 'paid' and l.paid_at is not null
         ) paid on paid.first_paid_at is not null
        where s.product_id = $1 and s.status in ('active', 'cancelled')
        order by paid.first_paid_at, s.id`,
      [productId],
    );
    const options = await this.optionsOf(rows.map((row) => row.id));
    return rows.map((row) => ({
      subscriptionId: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      options: options.get(row.id)?.options ?? [],
      joinedDate: row.joined,
      status: row.status,
      refundOwed: row.refund_owed,
    }));
  }

  /**
   * The newest set of each subscription, by subscription id: its `from_week`, its options by option type id, and the
   * options named in option-type position order.
   */
  private async optionsOf(subscriptionIds: string[]): Promise<Map<string, { fromWeek: string; choices: Record<string, string>; options: Subscriber["options"] }>> {
    const { rows } = await this.db.query<{ subscription_id: string; from_week: string; option_type_id: string; option_id: string; type_name: string; option_name: string }>(
      `select so.subscription_id, to_char(so.from_week, 'YYYY-MM-DD') as from_week, so.option_type_id, so.option_id,
              t.name as type_name, o.name as option_name
         from subscription_options so
         join option_types t on t.id = so.option_type_id
         join options o on o.id = so.option_id
        where so.subscription_id = any($1::uuid[]) and ${NEWEST_SET}
        order by t.position, t.name`,
      [subscriptionIds],
    );
    const bySubscription = new Map<string, { fromWeek: string; choices: Record<string, string>; options: Subscriber["options"] }>();
    for (const row of rows) {
      const picked = bySubscription.get(row.subscription_id) ?? { fromWeek: row.from_week, choices: {}, options: [] };
      picked.choices[row.option_type_id] = row.option_id;
      picked.options.push({ typeName: row.type_name, optionName: row.option_name });
      bySubscription.set(row.subscription_id, picked);
    }
    return bySubscription;
  }

  async getSignInCode(subjectId: string): Promise<SignInCode | null> {
    const { rows } = await this.db.query<SignInCodeRow>(
      `select member_id, code_hash, created_at, expires_at, attempts, consumed_at, failed_since, failed_in_window,
              link_hash, link_created_at, link_expires_at
         from sign_in_codes where member_id = $1`,
      [subjectId],
    );
    return rows[0] ? toSignInCode(rows[0]) : null;
  }

  async saveSignInCode(
    code: { subjectId: string; codeHash: string; createdAt: Date; expiresAt: Date },
    hold?: SaveHold,
  ): Promise<boolean> {
    // The failure window and the link fields are left alone: a new code resets neither. A hold is
    // part of the statement's `where`, so it is decided in the same atomic step as the write: a
    // concurrent upsert waits on the row, then re-checks the hold against what the first one wrote.
    const params: unknown[] = [code.subjectId, code.codeHash, code.createdAt, code.expiresAt];
    const { rowCount } = await this.db.query(
      `insert into sign_in_codes (member_id, code_hash, created_at, expires_at)
       values ($1, $2, $3, $4)
       on conflict (member_id) do update
         set code_hash = excluded.code_hash,
             created_at = excluded.created_at,
             expires_at = excluded.expires_at,
             attempts = 0,
             consumed_at = null
         ${holdWhere(hold, params)}`,
      params,
    );
    return rowCount === 1;
  }

  async saveSignInLink(
    link: { subjectId: string; linkHash: string; createdAt: Date; expiresAt: Date },
    hold?: SaveHold,
  ): Promise<boolean> {
    const params: unknown[] = [link.subjectId, link.linkHash, link.createdAt, link.expiresAt];
    const { rowCount } = await this.db.query(
      `update sign_in_codes
          set link_hash = $2, link_created_at = $3, link_expires_at = $4
        where member_id = $1
          ${holdWhere(hold, params, "and")}`,
      params,
    );
    return rowCount === 1;
  }

  /** One statement: concurrent redeems of a token queue on the row, and the later finds the link gone. */
  async redeemSignInLink(linkHash: string, now: Date): Promise<string | null> {
    const { rows } = await this.db.query<{ member_id: string }>(
      `update sign_in_codes
          set link_hash = null, link_created_at = null, link_expires_at = null,
              failed_since = null, failed_in_window = 0,
              consumed_at = coalesce(consumed_at, $2::timestamptz)
        where link_hash = $1 and $2::timestamptz < link_expires_at
        returning member_id`,
      [linkHash, now],
    );
    return rows[0]?.member_id ?? null;
  }

  /**
   * One row-locked `update … returning`, so concurrent claims cannot pass a cap together: a waiting
   * update re-reads the row and re-checks its `where` once the lock frees. With a null subject id the
   * same statement runs and matches no row.
   */
  async claimSignInAttempt(
    subjectId: string | null,
    claim: { presentedHash: string; maxAttempts: number; now: Date; windowMs: number; maxFailures: number },
  ): Promise<{ codeHash: string; expiresAt: Date; failedInWindow: number } | null> {
    // "Live": failed_since is set and now < failed_since + windowMs.
    const live = "(failed_since is not null and $3::timestamptz < failed_since + $4::double precision * interval '1 millisecond')";
    const { rows } = await this.db.query<{ code_hash: string; expires_at: Date; failed_in_window: number }>(
      `update sign_in_codes
          set attempts = attempts + 1,
              failed_since = case when code_hash = $2 or ${live} then failed_since else $3::timestamptz end,
              failed_in_window = case when code_hash = $2 then failed_in_window
                                      when ${live} then failed_in_window + 1
                                      else 1 end
        where member_id = $1
          and consumed_at is null
          and attempts < $5
          and not (${live} and failed_in_window >= $6)
        returning code_hash, expires_at, failed_in_window`,
      [subjectId, claim.presentedHash, claim.now, claim.windowMs, claim.maxAttempts, claim.maxFailures],
    );
    return rows[0]
      ? { codeHash: rows[0].code_hash, expiresAt: rows[0].expires_at, failedInWindow: rows[0].failed_in_window }
      : null;
  }

  async consumeSignInCode(subjectId: string, now: Date): Promise<boolean> {
    const { rowCount } = await this.db.query(
      "update sign_in_codes set consumed_at = $2 where member_id = $1 and consumed_at is null",
      [subjectId, now],
    );
    return rowCount === 1;
  }

  async incrementRateLimit(bucket: string, key: string, windowStart: Date, expiresAt: Date, now: Date): Promise<number> {
    // Two statements, not one CTE: within one statement the upsert would still see the expired row
    // the delete removes, and count on from it instead of starting at 1.
    await this.db.query("delete from rate_limit_hits where expires_at <= $1", [now]);
    const { rows } = await this.db.query<{ hits: number }>(
      `insert into rate_limit_hits (bucket, key, window_start, expires_at, hits)
       values ($1, $2, $3, $4, 1)
       on conflict (bucket, key, window_start) do update set hits = rate_limit_hits.hits + 1
       returning hits`,
      [bucket, key, windowStart, expiresAt],
    );
    return (rows[0] as { hits: number }).hits;
  }

  /** Writes the event's `audit_log` row through `audit_event()`, which writes event rows and nothing else. */
  async recordEvent(event: AuditEvent): Promise<void> {
    if (event.kind === "rate_limit_refusal") {
      // The row_key is the counter row's primary key, built in SQL from typed parameters.
      await this.db.query(
        `select public.audit_event($1, 'rate_limit_hits',
           jsonb_build_object('bucket', $2::text, 'key', $3::text, 'window_start', $4::timestamptz), null::jsonb)`,
        [event.kind, event.bucket, event.key, event.windowStart],
      );
      return;
    }
    await this.db.query("select public.audit_event($1, 'members', jsonb_build_object('id', $2::text), $3::jsonb)", [
      event.kind,
      event.memberId,
      event.detail === undefined ? null : JSON.stringify(event.detail),
    ]);
  }

  /**
   * One transaction, opened with `haul.actor` set for it alone (DEC-019: inside a transaction, never
   * per connection, so a pooled connection carries it into no one else's request). Every query `fn`
   * makes through the repository it is given runs in it; it commits when `fn` resolves and rolls back
   * when it throws. It does not nest.
   */
  async withActor<T>(actor: Actor, fn: (repo: Repository) => Promise<T>): Promise<T> {
    if (this.scoped) throw new Error("withActor does not nest");
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query("begin");
      await client.query("select set_config('haul.actor', $1, true)", [actorText(actor)]);
      const view: PostgresRepository = Object.create(this);
      view.db = client;
      view.scoped = true;
      const result = await fn(view);
      await client.query("commit");
      return result;
    } catch (error) {
      // A failed rollback leaves the connection in an unknown state: the pool must drop it.
      await client.query("rollback").catch(() => {
        broken = true;
      });
      throw error;
    } finally {
      client.release(broken);
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
