// A migration is editable until its pull request merges, never after (DEC-013, issue 60).
// db/migrate.ts's checksum refuses an edited applied file at production's migrate; this refuses it
// at the pull request, since test databases rebuild from scratch and never notice.
//
// Every file under db/migrations/ that the working tree has modified, deleted or renamed since its
// merge base with origin/main, or with origin/production, fails. A new file passes. With neither
// ref present it fails: a check that skips silently passes everything.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = "db/migrations";
const BASES = ["origin/main", "origin/production"];
const KIND = { M: "modified", D: "deleted", R: "renamed", T: "modified" };

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

/** One line per merged migration the working tree has changed; empty when there are none. */
export function migrationViolations(cwd) {
  const bases = BASES.filter((ref) => git(cwd, "rev-parse", "--verify", "-q", ref).status === 0);
  if (bases.length === 0) {
    throw new Error(`check:migrations: neither ${BASES.join(" nor ")} exists; run git fetch origin main production`);
  }
  const found = new Set();
  for (const ref of bases) {
    const mergeBase = git(cwd, "merge-base", "HEAD", ref);
    if (mergeBase.status !== 0) throw new Error(`check:migrations: no merge base with ${ref}: ${mergeBase.stderr}`);
    const diff = git(cwd, "diff", "--name-status", "-M", mergeBase.stdout.trim(), "--", DIR);
    if (diff.status !== 0) throw new Error(`check:migrations: git diff failed: ${diff.stderr}`);
    for (const line of diff.stdout.split("\n").filter(Boolean)) {
      const [status, path] = line.split("\t");
      const kind = KIND[status[0]];
      if (kind) found.add(`${kind}: ${path}`);
    }
  }
  return [...found].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const violations = migrationViolations(process.cwd());
    if (violations.length > 0) {
      console.error("check:migrations: a merged migration changed. Put it back and write a new one (DEC-013):");
      for (const v of violations) console.error(`  ${v}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
