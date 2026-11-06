// Issue 55, AC1: findProductByName against real Postgres, in a database of its own: `<test db>_product`,
// created if absent, migrated once, emptied before each test. Without a reachable Postgres it skips
// locally and fails in CI (DEC-014). Issue 56: the signup rows, which need a product, then what only
// Postgres can show: the stored columns, concurrent callers, and who the audit trigger names.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runSeed } from "../../db/seed.js";
import type { Repository } from "../ports/repository.js";
import { SUPPER_CLUB_PRODUCT_NAME, type ProductInput, type ProductWithOptions } from "../products.js";
import { signUp, type SignupDeps } from "../signup.js";
import { FakePayments } from "./fake-payments.js";
import { createPool } from "./pg-connect.js";
import { PostgresRepository } from "./postgres-repository.js";
import { runProductContract } from "./product-contract.js";
import { runSignupContract } from "./repository-contract.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "./test-database.js";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC1 — findProductByName in <test db>_product${skipped}`, () => {
  let url: string;
  let pool: ReturnType<typeof createPool>;
  let repo: PostgresRepository;

  beforeAll(async () => {
    url = await migrateTestDatabase(TEST_DATABASE_URL, "product");
    pool = createPool(url);
    repo = new PostgresRepository(url);
  });

  afterAll(async () => {
    await repo?.close();
    await pool?.end();
  });

  const truncateAll = async (): Promise<void> => {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'",
    );
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  };

  /** Inserts the rows, in the order given, and reads the product back. */
  const addProduct = async (input: ProductInput): Promise<ProductWithOptions> => {
    const product = await pool.query<{ id: string }>(
      `insert into products (name, cap, first_pickup_date, cutoff_weekday, cutoff_time)
       values ($1, $2, $3, $4, $5) returning id`,
      [input.name, input.cap, input.firstPickupDate, input.cutoffWeekday, input.cutoffTime],
    );
    for (const type of input.optionTypes) {
      const row = await pool.query<{ id: string }>(
        "insert into option_types (product_id, name, position) values ($1, $2, $3) returning id",
        [product.rows[0]?.id, type.name, type.position],
      );
      for (const option of type.options) {
        await pool.query("insert into options (option_type_id, name, price_cents, position) values ($1, $2, $3, $4)", [
          row.rows[0]?.id,
          option.name,
          option.priceCents,
          option.position,
        ]);
      }
    }
    const found = await repo.findProductByName(input.name);
    expect(found, `findProductByName found nothing for the rows just inserted for ${input.name}`).not.toBeNull();
    return found as ProductWithOptions;
  };

  runProductContract("postgres", async () => repo, addProduct, truncateAll);
  runSignupContract("postgres", async () => repo, addProduct, truncateAll);

  it("AC1, AC14 (issue 77): the supper-club seed's product is found by SUPPER_CLUB_PRODUCT_NAME, its pickers in the seed's order", async () => {
    await truncateAll();
    await runSeed("supper-club", url);

    const found = await repo.findProductByName(SUPPER_CLUB_PRODUCT_NAME);
    expect(found).toMatchObject({ name: "Supper Club", cap: 50, firstPickupDate: "2027-01-03", cutoffWeekday: 1, cutoffTime: "24:00:00" });
    expect(found?.optionTypes.map((type) => [type.name, type.options.map((option) => [option.name, option.priceCents])])).toEqual([
      ["How many people?", [["3–4 people", 8000], ["2 people", 5000]]],
      ["Which menu?", [["Standard", 0], ["Vegan", 0]]],
    ]);
  });

  describe("issue 56 — the signup rows in Postgres", () => {
    const NOW = new Date("2026-11-06T15:00:00.000Z");
    const PAID_AT = new Date("2026-11-06T15:00:05.000Z");
    const CONSENT = "I agree to a weekly charge of $50 until I cancel, and to the Terms and Privacy Policy.";

    /** A confirmed member, the product and the picks a signup needs. */
    const fixture = async (sizes: ProductInput["optionTypes"][number]["options"] = [{ name: "3–4 people", priceCents: 8000, position: 1 }]) => {
      await truncateAll();
      const product = await addProduct({
        name: SUPPER_CLUB_PRODUCT_NAME,
        cap: 50,
        firstPickupDate: "2027-01-03",
        cutoffWeekday: 1,
        cutoffTime: "24:00:00",
        optionTypes: [
          { name: "How many people?", position: 1, options: sizes },
          { name: "Which menu?", position: 2, options: [{ name: "Vegan", priceCents: 0, position: 1 }] },
        ],
      });
      const member = await repo.createMember({ email: "ada@example.com" });
      await repo.confirmMemberEmail(member.id, NOW);
      const choices = Object.fromEntries(product.optionTypes.map((type) => [type.id, type.options[0]?.id ?? "no option"]));
      const input = {
        memberId: member.id,
        productId: product.id,
        choices,
        firstChargeCents: 8000,
        weeklyCents: 8000,
        pickupDate: "2027-01-03",
        consentText: CONSENT,
        consentAt: NOW,
      };
      return { product, member, choices, input };
    };

    const count = async (table: string): Promise<number> =>
      Number((await pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

    const mark = async (): Promise<string> =>
      (await pool.query<{ n: string }>("select coalesce(max(id), 0)::text as n from audit_log")).rows[0]?.n ?? "0";

    const auditSince = async (m: string) =>
      (
        await pool.query<{ table_name: string; operation: string; event: string | null; actor: string | null }>(
          "select table_name, operation, event, actor from audit_log where id > $1::bigint order by id",
          [m],
        )
      ).rows;

    const deps = (payments: FakePayments): SignupDeps => ({ repo, payments, now: NOW });

    it("AC4: the subscription stores the consent wording, the time and the amounts, and the ledger row the amount and pickup date", async () => {
      const { input, member, product } = await fixture();
      await repo.savePendingSignup(input);
      const { rows: subscriptions } = await pool.query(
        "select member_id, product_id, status, consent_text, consent_at, first_charge_cents, weekly_cents from subscriptions",
      );
      expect(subscriptions).toEqual([
        {
          member_id: member.id,
          product_id: product.id,
          status: "pending",
          consent_text: CONSENT,
          consent_at: NOW,
          first_charge_cents: 8000,
          weekly_cents: 8000,
        },
      ]);
      const { rows: ledger } = await pool.query(
        "select to_char(pickup_date, 'YYYY-MM-DD') as pickup_date, amount_cents, status, attempt, square_payment_id, paid_at from ledger",
      );
      expect(ledger).toEqual([{ pickup_date: "2027-01-03", amount_cents: 8000, status: "pending", attempt: 1, square_payment_id: null, paid_at: null }]);
    });

    it("AC4: a save after a decline rewrites the consent wording and time", async () => {
      const { input } = await fixture();
      const first = await repo.savePendingSignup(input);
      await repo.recordSignupDecline(first.ledgerId);
      await repo.savePendingSignup({ ...input, consentText: "New wording.", consentAt: PAID_AT });
      const { rows } = await pool.query("select consent_text, consent_at from subscriptions");
      expect(rows).toEqual([{ consent_text: "New wording.", consent_at: PAID_AT }]);
    });

    it("AC7: each picked option is a subscription_options row", async () => {
      const { input, choices } = await fixture();
      await repo.savePendingSignup(input);
      const { rows } = await pool.query<{ option_type_id: string; option_id: string }>("select option_type_id, option_id from subscription_options");
      expect(Object.fromEntries(rows.map((row) => [row.option_type_id, row.option_id]))).toEqual(choices);
    });

    it("AC8: confirmSignupRows stores the payment id and paid_at, and flips both rows", async () => {
      const { input } = await fixture();
      const signup = await repo.savePendingSignup(input);
      await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
      expect((await pool.query("select status from subscriptions")).rows).toEqual([{ status: "active" }]);
      expect((await pool.query("select status, square_payment_id, paid_at from ledger")).rows).toEqual([
        { status: "paid", square_payment_id: "PAYMENT_1", paid_at: PAID_AT },
      ]);
    });

    it("AC8: the audit trigger records the flip of both rows, and no event row is written", async () => {
      const { input } = await fixture();
      const signup = await repo.savePendingSignup(input);
      const m = await mark();
      await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
      const rows = await auditSince(m);
      expect(rows.map((row) => [row.table_name, row.operation]).sort()).toEqual([
        ["ledger", "update"],
        ["subscriptions", "update"],
      ]);
    });

    it("AC6: a Square customer id belongs to one member", async () => {
      const { member } = await fixture();
      const grace = await repo.createMember({ email: "grace@example.com" });
      await repo.setMemberSquareCustomer(member.id, "CUSTOMER_1");
      await expect(repo.setMemberSquareCustomer(grace.id, "CUSTOMER_1")).rejects.toMatchObject({ code: "23505" });
      expect((await repo.findMemberById(member.id))?.squareCustomerId).toBe("CUSTOMER_1");
    });

    it("AC11: two savePendingSignup calls at once leave one subscription and one ledger row", async () => {
      const { input } = await fixture();
      await Promise.all([repo.savePendingSignup(input), repo.savePendingSignup(input)]);
      expect(await count("subscriptions")).toBe(1);
      expect(await count("ledger")).toBe(1);
    });

    it('AC11: two confirmSignupRows calls at once give one "confirmed" and one "already"', async () => {
      const { input } = await fixture();
      const signup = await repo.savePendingSignup(input);
      const results = await Promise.all([
        repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT),
        repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT),
      ]);
      expect([...results].sort()).toEqual(["already", "confirmed"]);
    });

    it("AC11: a double submit gives one subscription, one ledger row and one charge", async () => {
      const { member, choices } = await fixture();
      const payments = new FakePayments();
      const submit = () => signUp(deps(payments), { memberId: member.id, choices, sourceId: "cnon:card-nonce-ok", consentText: CONSENT });
      const results = await Promise.all([submit(), submit()]);
      expect(results.map((result) => result.outcome)).toContain("paid");
      expect(payments.charges).toHaveLength(1);
      expect(await count("subscriptions")).toBe(1);
      expect(await count("ledger")).toBe(1);
    });

    it("AC8: everything a paid signUp writes names the member as its actor, and it records no event", async () => {
      const { member, choices } = await fixture();
      const m = await mark();
      const result = await signUp(deps(new FakePayments()), { memberId: member.id, choices, sourceId: "cnon:card-nonce-ok", consentText: CONSENT });
      expect(result.outcome).toBe("paid");
      const rows = await auditSince(m);
      expect(new Set(rows.map((row) => row.table_name))).toEqual(new Set(["members", "subscriptions", "subscription_options", "ledger"]));
      expect(rows.filter((row) => row.actor !== `member:${member.id}`)).toEqual([]);
      expect(rows.filter((row) => row.operation === "event")).toEqual([]);
    });

    it("AC9: everything a declined signUp writes or records names the member as its actor", async () => {
      const { member, choices } = await fixture();
      const payments = new FakePayments();
      const save = payments.saveCard.bind(payments);
      payments.saveCard = async (input) => {
        const card = await save(input);
        payments.declineCard(card.id, "GENERIC_DECLINE");
        return card;
      };
      const m = await mark();
      const result = await signUp(deps(payments), { memberId: member.id, choices, sourceId: "cnon:card-nonce-ok", consentText: CONSENT });
      expect(result.outcome).toBe("declined");
      const rows = await auditSince(m);
      expect(rows.filter((row) => row.event === "card_declined")).toHaveLength(1);
      expect(rows.filter((row) => row.actor !== `member:${member.id}`)).toEqual([]);
    });

    describe("AC11 — a second tab, on real rows", () => {
      const FIRST_TAB = "cnon:card-nonce-ok";
      const SECOND_TAB = "cnon:second-tab";

      afterEach(() => {
        vi.restoreAllMocks();
      });

      /** The member has their Square customer, so a tab goes straight from its checks to its save. */
      const withCustomer = async (memberId: string): Promise<FakePayments> => {
        const payments = new FakePayments();
        const { id } = payments.addCustomer({ email: "ada@example.com", createdAt: NOW, updatedAt: NOW });
        await repo.setMemberSquareCustomer(memberId, id);
        return payments;
      };

      /** Resolves "waiting" once a query is blocked on a lock in this database, or "no lock" when none has been for a while. */
      const blockedOnALock = async (): Promise<"waiting" | "no lock"> => {
        for (let tries = 0; tries < 50; tries++) {
          const { rows } = await pool.query<{ n: string }>(
            "select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
          );
          if (Number(rows[0]?.n) > 0) return "waiting";
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return "no lock";
      };

      it("AC11: a tab whose save lands after the first confirms gets already_subscribed, with no second row or charge", async () => {
        const { member, choices } = await fixture();
        const payments = await withCustomer(member.id);
        const submit = (sourceId: string) => signUp(deps(payments), { memberId: member.id, choices, sourceId, consentText: CONSENT });
        const read = repo.findPendingSignup;
        vi.spyOn(repo, "findPendingSignup").mockImplementationOnce(async function (this: Repository, memberId, productId) {
          const found = await read.call(this, memberId, productId);
          await submit(FIRST_TAB);
          return found;
        });
        const m = await mark();
        expect((await submit(SECOND_TAB)).outcome).toBe("already_subscribed");
        expect(payments.charges).toHaveLength(1);
        expect(await count("subscriptions")).toBe(1);
        expect(await count("ledger")).toBe(1);
        expect((await auditSince(m)).filter((row) => row.event === "already_subscribed")).toHaveLength(1);
      });

      it("AC11: savePendingSignup waits on the member row's lock, and re-checks for an active subscription once it has it", async () => {
        const { input, member } = await fixture();
        const signup = await repo.savePendingSignup(input);
        const holder = await pool.connect();
        try {
          await holder.query("begin");
          await holder.query("select id from members where id = $1 for update", [member.id]);
          const second = repo.savePendingSignup({ ...input, consentText: "The second tab's wording." }).catch(() => null);
          expect(await Promise.race([second.then(() => "landed"), blockedOnALock()])).toBe("waiting");

          // The first tab's confirm commits as the lock frees, so only a check made under the lock can see it.
          await holder.query("update ledger set status = 'paid', square_payment_id = 'PAYMENT_1', paid_at = $2 where id = $1", [signup.ledgerId, PAID_AT]);
          await holder.query("update subscriptions set status = 'active' where id = $1", [signup.subscriptionId]);
          await holder.query("commit");
          await second;
        } finally {
          await holder.query("rollback");
          holder.release();
        }
        expect(await count("subscriptions")).toBe(1);
        expect((await pool.query("select consent_text from subscriptions")).rows).toEqual([{ consent_text: CONSENT }]);
      });

      it("AC11: a rewrite refused over a bound card leaves the consent wording, its time and the amounts as they were", async () => {
        const { input } = await fixture();
        const signup = await repo.savePendingSignup(input);
        await repo.saveSubscriptionCard(signup.subscriptionId, "ccof:card-1");
        await repo.savePendingSignup({ ...input, consentText: "New wording.", consentAt: PAID_AT, firstChargeCents: 100, weeklyCents: 100 }).catch(() => null);
        expect((await pool.query("select consent_text, consent_at, first_charge_cents, weekly_cents from subscriptions")).rows).toEqual([
          { consent_text: CONSENT, consent_at: NOW, first_charge_cents: 8000, weekly_cents: 8000 },
        ]);
      });

      it("AC11: saveSubscriptionCard leaves a subscription that is no longer pending alone", async () => {
        const { input } = await fixture();
        const signup = await repo.savePendingSignup(input);
        await repo.confirmSignupRows(signup.ledgerId, "PAYMENT_1", signup.amountCents, PAID_AT);
        await repo.saveSubscriptionCard(signup.subscriptionId, "ccof:late");
        expect((await pool.query("select square_card_id from subscriptions")).rows).toEqual([{ square_card_id: null }]);
      });

      // The order is forced, so it fails every run and not only when the timing falls that way: the cheap
      // tab saves and stops; the dear tab rewrites the row and stops; the cheap tab binds and charges.
      it("AC11: two tabs with different picks: the charge is the ledger's amount, on the ledger's picks", async () => {
        const { product, member } = await fixture([
          { name: "2 people", priceCents: 5000, position: 1 },
          { name: "3–4 people", priceCents: 8000, position: 2 },
        ]);
        const [size, menu] = product.optionTypes;
        const box = (at: number) => ({ [size?.id ?? "no size"]: size?.options[at]?.id ?? "no option", [menu?.id ?? "no menu"]: menu?.options[0]?.id ?? "no option" });
        const payments = await withCustomer(member.id);

        const gate = () => {
          let open = () => {};
          const opened = new Promise<void>((resolve) => {
            open = resolve;
          });
          return { open, opened };
        };
        const cheapAtCard = gate();
        const dearAtCard = gate();
        const charged = gate();
        const saveCard = payments.saveCard.bind(payments);
        payments.saveCard = async (card) => {
          if (card.sourceId === FIRST_TAB) {
            cheapAtCard.open();
            await dearAtCard.opened;
          } else {
            dearAtCard.open();
            await charged.opened;
          }
          return saveCard(card);
        };
        const charge = payments.charge.bind(payments);
        payments.charge = async (request) => {
          try {
            return await charge(request);
          } finally {
            charged.open();
          }
        };

        const submit = (at: number, sourceId: string) => signUp(deps(payments), { memberId: member.id, choices: box(at), sourceId, consentText: CONSENT });
        const cheap = submit(0, FIRST_TAB);
        await cheapAtCard.opened;
        const results = await Promise.all([cheap, submit(1, SECOND_TAB)]);

        const { rows } = await pool.query<{ amount_cents: number; status: string }>("select amount_cents, status from ledger");
        expect(payments.charges.map((request) => request.amountCents)).toEqual(rows.map((row) => row.amount_cents));
        expect(rows).toEqual([{ amount_cents: 8000, status: "paid" }]);
        expect(results.map((result) => result.outcome).sort()).toEqual(["already_subscribed", "paid"]);
        expect(await count("subscriptions")).toBe(1);
        const picked = await pool.query<{ option_id: string }>("select option_id from subscription_options");
        expect(picked.rows.map((row) => row.option_id).sort()).toEqual(Object.values(box(1)).sort());
      });

      it("AC11: a charge that no longer matches the ledger leaves both rows pending, and the event holds both amounts", async () => {
        const { member, choices } = await fixture();
        const payments = new FakePayments();
        const charge = payments.charge.bind(payments);
        payments.charge = async (request) => {
          await pool.query("update ledger set amount_cents = 9000");
          return charge(request);
        };
        const result = await signUp(deps(payments), { memberId: member.id, choices, sourceId: FIRST_TAB, consentText: CONSENT });
        expect(result.outcome).toBe("unknown");
        expect(payments.charges.map((request) => request.amountCents)).toEqual([8000]);
        expect((await pool.query("select status from subscriptions")).rows).toEqual([{ status: "pending" }]);
        expect((await pool.query("select status, square_payment_id from ledger")).rows).toEqual([{ status: "pending", square_payment_id: null }]);
        const { rows } = await pool.query<{ detail: object; actor: string }>("select detail, actor from audit_log where event = 'charge_outcome_unknown'");
        expect(rows.map((row) => row.actor)).toEqual([`member:${member.id}`]);
        expect(Object.values(rows[0]?.detail ?? {})).toEqual(expect.arrayContaining([8000, 9000]));
      });
    });
  });
});
