import type { AccountDetails } from "../create-account.js";
import { DEFAULT_LANGUAGE, type Language } from "../i18n.js";
import { DEFAULT_ROLE, DuplicateEmailError, normalizeEmail, type Member, type Role } from "../members.js";
import {
  SignupRefusedError,
  type Actor,
  type AuditEvent,
  type PendingSignup,
  type PendingSignupInput,
  type Repository,
  type SignupConfirmation,
  type Subscriber,
} from "../ports/repository.js";
import { isSoldOut, type ProductOptionType, type ProductWithOptions } from "../products.js";
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
        type = { id: r.option_type_id, name: r.option_type_name, position: r.option_type_position, options: [] };
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

    const typeIds = Object.keys(input.choices);
    const optionIds = typeIds.map((typeId) => input.choices[typeId]);
    await this.db.query(
      `delete from subscription_options where subscription_id = $1 and option_type_id <> all($2::uuid[])`,
      [subscriptionId, typeIds],
    );
    await this.db.query(
      `insert into subscription_options (subscription_id, option_type_id, option_id)
       select $1, picked.option_type_id, picked.option_id from unnest($2::uuid[], $3::uuid[]) as picked (option_type_id, option_id)
       on conflict (subscription_id, option_type_id) do update set option_id = excluded.option_id
         where subscription_options.option_id is distinct from excluded.option_id`,
      [subscriptionId, typeIds, optionIds],
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
   * the ledger's leaves both rows pending and says "mismatch".
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
    await this.db.query("update subscriptions set status = 'active' where id = $1", [row.subscription_id]);
    return "confirmed";
  }

  async findSignupConfirmation(memberId: string, productId: string): Promise<SignupConfirmation | null> {
    if (!UUID_SHAPE.test(memberId) || !UUID_SHAPE.test(productId)) return null;
    const found = await this.db.query<{ id: string; pickup_date: string; first_charge_cents: number; weekly_cents: number }>(
      `select s.id, to_char(l.pickup_date, 'YYYY-MM-DD') as pickup_date, s.first_charge_cents, s.weekly_cents
         from subscriptions s
         join ledger l on l.subscription_id = s.id
        where s.member_id = $1 and s.product_id = $2 and s.status = 'active'
        order by s.created_at desc, l.pickup_date
        limit 1`,
      [memberId, productId],
    );
    const row = found.rows[0];
    if (!row) return null;
    return {
      pickupDate: row.pickup_date,
      firstChargeCents: row.first_charge_cents,
      weeklyCents: row.weekly_cents,
      options: (await this.optionsOf([row.id])).get(row.id) ?? [],
    };
  }

  /**
   * The active subscriptions to the product, each with its member and the date its first paid row was paid, in
   * Cleveland. A subscription with no paid row is left out: only a paid row makes one active. Stable by the date
   * joined, then by id.
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
    }>(
      `select s.id, m.first_name, m.last_name, m.email, m.phone,
              to_char(paid.first_paid_at at time zone 'America/New_York', 'YYYY-MM-DD') as joined
         from subscriptions s
         join members m on m.id = s.member_id
         join lateral (
           select min(l.paid_at) as first_paid_at from ledger l
            where l.subscription_id = s.id and l.status = 'paid' and l.paid_at is not null
         ) paid on paid.first_paid_at is not null
        where s.product_id = $1 and s.status = 'active'
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
      options: options.get(row.id) ?? [],
      joinedDate: row.joined,
    }));
  }

  /** The options each subscription picked, in option-type position order, by subscription id. */
  private async optionsOf(subscriptionIds: string[]): Promise<Map<string, Subscriber["options"]>> {
    const { rows } = await this.db.query<{ subscription_id: string; type_name: string; option_name: string }>(
      `select so.subscription_id, t.name as type_name, o.name as option_name
         from subscription_options so
         join option_types t on t.id = so.option_type_id
         join options o on o.id = so.option_id
        where so.subscription_id = any($1::uuid[])
        order by t.position, t.name`,
      [subscriptionIds],
    );
    const bySubscription = new Map<string, Subscriber["options"]>();
    for (const row of rows) {
      const picked = bySubscription.get(row.subscription_id) ?? [];
      picked.push({ typeName: row.type_name, optionName: row.option_name });
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
