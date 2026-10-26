/**
 * `npm run db:new-migration <name>` scaffolds `db/migrations/<UTC YYYYMMDDHHMMSS>_<slug>.sql`
 * (DEC-013). The runner orders by filename, so a timestamp keeps filename order chronological, and
 * two branches authoring at different moments can't collide on a sequence number.
 */
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/** UTC, 14 digits, no separators. */
function stamp(d: Date): string {
  const p = (n: number, width = 2) => n.toString().padStart(width, "0");
  return (
    p(d.getUTCFullYear(), 4) +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}

/** Creates the migration file and returns its path. Throws for a name with nothing usable in it. */
export function newMigration(name: string, dir: string = MIGRATIONS_DIR, now: Date = new Date()): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) throw new Error(`'${name}' has no usable [a-z0-9] characters for a slug`);

  // Bump one second until the name is free, for two generated in the same second.
  let when = now;
  let filename = `${stamp(when)}_${slug}.sql`;
  while (existsSync(join(dir, filename))) {
    when = new Date(when.getTime() + 1000);
    filename = `${stamp(when)}_${slug}.sql`;
  }

  const path = join(dir, filename);
  writeFileSync(path, `-- ${filename} — ${name}\n-- Applied in filename order by db/migrate.ts (DEC-013).\n\n`);
  return path;
}

// CLI: `tsx db/new-migration.ts <name>`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const name = process.argv.slice(2).join(" ").trim();
  if (!name) {
    console.error("usage: npm run db:new-migration <name>");
    process.exit(1);
  }
  try {
    console.log(newMigration(name));
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
}
