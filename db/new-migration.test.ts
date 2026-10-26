// `newMigration` in a temporary directory — never db/migrations/.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newMigration } from "./new-migration.js";

const root = fileURLToPath(new URL("..", import.meta.url));

// 02:03:04 UTC on 1 January is still 31 December in New York, so a stamp taken in local time
// shows up as the wrong day.
const NOW = new Date("2026-01-01T02:03:04Z");

describe("AC6 — newMigration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "haul-new-migration-"));
    vi.stubEnv("TZ", "America/New_York");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("AC6: creates <UTC YYYYMMDDHHMMSS>_add_widget.sql for 'add widget' and returns its path", () => {
    const path = newMigration("add widget", dir, NOW);
    expect(path).toBe(join(dir, "20260101020304_add_widget.sql"));
    expect(existsSync(path)).toBe(true);
    expect(readdirSync(dir)).toEqual(["20260101020304_add_widget.sql"]);
  });

  it("AC6: throws muster's message for a name with no [a-z0-9] characters, and creates nothing", () => {
    expect(() => newMigration("!!! ---", dir, NOW)).toThrow(
      "'!!! ---' has no usable [a-z0-9] characters for a slug",
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it("AC6: a name colliding with an existing file in the same second bumps the stamp by one second", () => {
    writeFileSync(join(dir, "20260101020304_add_widget.sql"), "-- already here\n");

    expect(newMigration("add widget", dir, NOW)).toBe(join(dir, "20260101020305_add_widget.sql"));
    expect(readFileSync(join(dir, "20260101020304_add_widget.sql"), "utf8")).toBe("-- already here\n");
  });

  it("AC6: two calls in the same second get consecutive stamps", () => {
    const first = newMigration("add widget", dir, NOW);
    const second = newMigration("add widget", dir, NOW);
    expect([first, second]).toEqual([
      join(dir, "20260101020304_add_widget.sql"),
      join(dir, "20260101020305_add_widget.sql"),
    ]);
  });

  it("AC6: the bump carries into the next minute rather than writing second 60", () => {
    const at59 = new Date("2026-01-01T02:03:59Z");
    writeFileSync(join(dir, "20260101020359_add_widget.sql"), "");
    expect(newMigration("add widget", dir, at59)).toBe(join(dir, "20260101020400_add_widget.sql"));
  });
});

describe("AC6 — the db:new-migration CLI", () => {
  it("AC6: exits 1 for a name with no [a-z0-9] characters, and writes nothing to db/migrations/", () => {
    const migrations = join(root, "db/migrations");
    const before = existsSync(migrations) ? readdirSync(migrations) : [];

    const run = spawnSync("npm", ["run", "--silent", "db:new-migration", "--", "!!!"], {
      cwd: root,
      encoding: "utf8",
    });

    const after = existsSync(migrations) ? readdirSync(migrations) : [];
    const strays = after.filter((f) => !before.includes(f));
    for (const f of strays) rmSync(join(migrations, f));

    expect(strays).toEqual([]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("'!!!' has no usable [a-z0-9] characters for a slug");
  });
});
