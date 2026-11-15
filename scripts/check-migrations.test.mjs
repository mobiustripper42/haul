// A merged migration is never edited, deleted or renamed (issue 60, DEC-013): the checksum in
// db/migrate.ts refuses one at production's migrate; this refuses it at the pull request.
import { spawnSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrationViolations } from "./check-migrations.mjs";

const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;

let dir;
const git = (...args) => {
  const run = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr);
  return run.stdout;
};
const file = (name) => join(dir, "db/migrations", name);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "check-migrations-"));
  git("init", "-q", "-b", "task");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  mkdirSync(join(dir, "db/migrations"), { recursive: true });
  writeFileSync(file("20260101000000_one.sql"), "create table one (id int);\n");
  git("add", ".");
  git("commit", "-q", "-m", "merged");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("check:migrations (issue 60)", () => {
  it("a new migration passes", () => {
    writeFileSync(file("20260102000000_two.sql"), "create table two (id int);\n");
    git("add", ".");
    git("commit", "-q", "-m", "new");
    expect(migrationViolations(dir)).toEqual([]);
  });

  it("an edited merged migration fails, committed or not", () => {
    writeFileSync(file("20260101000000_one.sql"), "create table one (id bigint);\n");
    expect(migrationViolations(dir)).toEqual(["modified: db/migrations/20260101000000_one.sql"]);
    git("commit", "-q", "-am", "edit");
    expect(migrationViolations(dir)).toEqual(["modified: db/migrations/20260101000000_one.sql"]);
  });

  it("a deleted merged migration fails", () => {
    rmSync(file("20260101000000_one.sql"));
    expect(migrationViolations(dir)).toEqual(["deleted: db/migrations/20260101000000_one.sql"]);
  });

  it("a renamed merged migration fails", () => {
    renameSync(file("20260101000000_one.sql"), file("20260103000000_one.sql"));
    git("add", "-A");
    expect(migrationViolations(dir)).toEqual(["renamed: db/migrations/20260101000000_one.sql"]);
  });

  it("checks against origin/production too, when only it has the migration", () => {
    git("update-ref", "-d", "refs/remotes/origin/main");
    git("update-ref", "refs/remotes/origin/production", "HEAD");
    writeFileSync(file("20260101000000_one.sql"), "edited\n");
    expect(migrationViolations(dir)).toEqual(["modified: db/migrations/20260101000000_one.sql"]);
  });

  it("with neither origin/main nor origin/production, it throws rather than passing", () => {
    git("update-ref", "-d", "refs/remotes/origin/main");
    expect(() => migrationViolations(dir)).toThrow(/git fetch origin main/);
  });

  it("runs in verify, before typecheck", () => {
    const steps = scripts.verify.split(" && ");
    expect(scripts["check:migrations"]).toBe("node scripts/check-migrations.mjs");
    expect(steps.indexOf("npm run check:migrations")).toBe(steps.indexOf("npm run typecheck") - 1);
  });
});
