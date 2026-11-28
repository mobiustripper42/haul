// Issue 263's Seeds section: the people the members list's rolldowns and the never-subscribed card need, which AC10's
// by-hand check and e2e/admin-members.spec.ts start from, in a database of this suite's own, `<test db>_members_list`,
// emptied before each test. The rules every seed keeps (alone, twice, stacked, only its own rows) run on it in
// db/seed.test.ts. Read back through the repository the page reads, so a row here is a row on the list. Without a
// reachable Postgres these skip locally and fail in CI (DEC-014).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../../src/adapters/pg-connect.js";
import { PostgresRepository } from "../../src/adapters/postgres-repository.js";
import { migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../../src/adapters/test-database.js";
import { groupByMember } from "../../src/member-list.js";
import type { Subscriber } from "../../src/ports/repository.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../../src/products.js";
import { runSeed } from "../seed.js";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`issue 263's seed — members-list against <test db>_members_list${skipped}`, () => {
  let url: string;
  let pool: ReturnType<typeof createPool>;
  let repo: PostgresRepository;

  beforeAll(async () => {
    url = await migrateTestDatabase(TEST_DATABASE_URL, "members_list");
    pool = createPool(url);
    repo = new PostgresRepository(url);
  });

  afterAll(async () => {
    await repo?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'",
    );
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  });

  /** The Supper Club's list rows after the seed, by member email. */
  const byEmail = async (): Promise<{ rows: Subscriber[]; held: Map<string, Subscriber[]> }> => {
    await runSeed("members-list", url);
    const product = await repo.findProductByName(SUPPER_CLUB_PRODUCT_NAME);
    expect(product, "the members-list seed makes the Supper Club it needs").not.toBeNull();
    const rows = await repo.listSubscribers(product?.id ?? "");
    const held = new Map<string, Subscriber[]>();
    for (const row of rows) held.set(row.email, [...(held.get(row.email) ?? []), row]);
    return { rows, held };
  };

  it("AC3's seed: a rejoiner holds a cancelled subscription and a later active one, each paid, and is one person on the list, the active one current", async () => {
    const { rows, held } = await byEmail();

    const rejoiners = [...held.values()].filter((subs) => subs.length === 2 && subs.some((s) => s.status === "active") && subs.some((s) => s.status === "cancelled"));
    expect(rejoiners).toHaveLength(1);
    const cancelled = rejoiners[0]?.find((s) => s.status === "cancelled");
    const active = rejoiners[0]?.find((s) => s.status === "active");
    expect((active?.joinedDate ?? "") >= (cancelled?.joinedDate ?? "\uffff"), "the active subscription joined on or after the cancelled one").toBe(true);
    const person = groupByMember(rows).find((group) => group.current.email === active?.email);
    expect(person?.current.subscriptionId).toBe(active?.subscriptionId);
  });

  it("AC3's seed: a person holds two cancelled subscriptions, and the earlier one owes a refund, so Refund owed shows in the rolldown and not on the row", async () => {
    const { rows, held } = await byEmail();

    const twiceGone = [...held.values()].filter((subs) => subs.length === 2 && subs.every((s) => s.status === "cancelled"));
    expect(twiceGone).toHaveLength(1);
    const email = twiceGone[0]?.[0]?.email;
    const person = groupByMember(rows).find((group) => group.current.email === email);
    expect(person?.current.refundOwed).toBe(false);
    expect(person?.earlier.map((s) => s.refundOwed)).toEqual([true]);
  });

  it("AC7's seed: an unconfirmed member with no subscription, whose role is member", async () => {
    await runSeed("members-list", url);

    const { rows } = await pool.query<{ email: string }>(
      `select m.email from members m
        where m.email_confirmed_at is null and m.role = 'member'
          and not exists (select 1 from subscriptions s where s.member_id = m.id)`,
    );
    expect(rows).toHaveLength(1);
  });
});
