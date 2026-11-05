// Issue 55's `member_account` migration. Members from before it are confirmed, so AC7, not AC6, is what
// Create Account does to them. It runs against a database of this suite's own, `<test db>_member_account`,
// rebuilt from a temporary directory holding only the migrations before that one; the second test uses
// every migration in its own `<test db>_member_account_columns`. Without a reachable Postgres they skip
// locally and fail in CI (DEC-014).
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/adapters/pg-connect.js";
import { ensureTestDatabase, migrateTestDatabase, requireTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";
import { migrate, MIGRATIONS_DIR } from "./migrate.js";
import { rebuildDatabase } from "./rebuild.js";

const CHECK_VIOLATION = "23514";

const up = await requireTestDatabase(TEST_DATABASE_URL, { ci: Boolean(process.env.CI) });
const skipped = up ? "" : " — skipped: no Postgres at TEST_DATABASE_URL, run `npm run db:up`";

describe.skipIf(!up)(`AC7 — members from before the migration${skipped}`, () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "haul-member-account-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("AC7: a member who existed before it gets email_confirmed_at = created_at, and no name or phone", async () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
    const at = files.findIndex((file) => file.endsWith("_member_account.sql"));
    expect(at, "no db/migrations/<timestamp>_member_account.sql").toBeGreaterThanOrEqual(0);

    for (const file of files.slice(0, at)) copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    const url = await ensureTestDatabase(TEST_DATABASE_URL, "member_account");
    await rebuildDatabase(url, dir);

    const pool = createPool(url);
    try {
      await pool.query("insert into members (email, created_at) values ('old@example.com', '2026-10-01T12:00:00Z')");

      const file = files[at] ?? "";
      copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
      await migrate(url, dir);

      const { rows } = await pool.query("select created_at, email_confirmed_at, first_name, last_name, phone from members");
      expect(rows).toEqual([
        {
          created_at: new Date("2026-10-01T12:00:00Z"),
          email_confirmed_at: new Date("2026-10-01T12:00:00Z"),
          first_name: null,
          last_name: null,
          phone: null,
        },
      ]);
    } finally {
      await pool.end();
    }
  });
});

describe.skipIf(!up)(`AC5 — the new columns${skipped}`, () => {
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    pool = createPool(await migrateTestDatabase(TEST_DATABASE_URL, "member_account_columns"));
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("AC5: first_name, last_name and phone are nullable nonblank_text, and email_confirmed_at a nullable timestamptz", async () => {
    const { rows } = await pool.query(
      `select column_name, domain_name, data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'members'
          and column_name in ('first_name', 'last_name', 'phone', 'email_confirmed_at')
        order by column_name`,
    );
    expect(rows).toEqual([
      { column_name: "email_confirmed_at", domain_name: null, data_type: "timestamp with time zone", is_nullable: "YES" },
      { column_name: "first_name", domain_name: "nonblank_text", data_type: "text", is_nullable: "YES" },
      { column_name: "last_name", domain_name: "nonblank_text", data_type: "text", is_nullable: "YES" },
      { column_name: "phone", domain_name: "nonblank_text", data_type: "text", is_nullable: "YES" },
    ]);
  });

  it.each(["first_name", "last_name", "phone"])("AC5: a blank %s fails a check", async (column) => {
    const insert = pool.query(`insert into members (email, ${column}) values ($1, '   ')`, [`${column}@example.com`]);
    await expect(insert).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });
});
